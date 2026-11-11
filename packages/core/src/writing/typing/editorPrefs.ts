// Keeps the source editor's preferences (which typing helpers are on, how the selection popup behaves) in the library's editor-prefs.json, shared by both apps.
// CONTRACT: documents/contracts/library-format.md#editor-preferences-editor-prefsjson
import { KeyedQueue } from "../../async/index.js";
import { createListeners } from "../../events/index.js";
import { formatError } from "../../errors/index.js";
import { isRecord } from "../../guards/index.js";
import type { ILogger } from "../../ports/index.js";
import { DEFAULT_SELECTION_POPUP, formatSelectionPopupPrefs, isSameSelectionPopup, parseSelectionPopupPrefs, type SelectionPopupPrefs } from "../selectionPopup/prefs.js";
import { DEFAULT_TYPING_HELPERS, TYPING_HELPER_IDS, isSameTypingHelpers, type TypingHelperId, type TypingHelpers } from "./helpers.js";

/** The only version this code writes; a file with a higher one is read-only. */
const EDITOR_PREFS_VERSION = 1;
const MODULE = "writing/editorPrefs";

/** Reads and writes the whole editor-prefs.json; a missing file reads as null. */
export interface EditorPrefsPort {
  read(): Promise<string | null>;
  write(text: string): Promise<void>;
}

export interface EditorPrefs {
  typing: TypingHelpers;
  /** The selection popup's settings; undefined when the file has none, which reads as the defaults. */
  selectionPopup?: SelectionPopupPrefs;
  /** Top-level keys this version does not know, written back unchanged. */
  extra: Readonly<Record<string, unknown>>;
  /** Keys inside `typing` this version does not know, written back unchanged. */
  typingExtra: Readonly<Record<string, unknown>>;
  /** Set when the file must not be written, with the reason. */
  readOnlyReason?: string;
}

const isTypingHelperId = (key: string): key is TypingHelperId => (TYPING_HELPER_IDS as readonly string[]).includes(key);

const DEFAULT_PREFS: EditorPrefs = { typing: DEFAULT_TYPING_HELPERS, extra: {}, typingExtra: {} };

/** Defensive parse: a missing helper is on; a non-JSON file or a higher version reads as the defaults, read-only. */
export function parseEditorPrefs(text: string | null): EditorPrefs {
  if (text === null) return DEFAULT_PREFS;
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch (error) { return { ...DEFAULT_PREFS, readOnlyReason: `editor-prefs.json is not JSON: ${formatError(error)}` }; }
  if (!isRecord(parsed)) return { ...DEFAULT_PREFS, readOnlyReason: "editor-prefs.json is not a JSON object" };
  const { version, typing: rawTyping, selectionPopup: rawPopup, ...extra } = parsed;
  if (version !== undefined && (typeof version !== "number" || version > EDITOR_PREFS_VERSION)) {
    return { ...DEFAULT_PREFS, readOnlyReason: `editor-prefs.json has version ${String(version)}, newer than ${EDITOR_PREFS_VERSION}` };
  }
  const typing: Record<TypingHelperId, boolean> = { ...DEFAULT_TYPING_HELPERS };
  const typingExtra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(isRecord(rawTyping) ? rawTyping : {})) {
    if (!isTypingHelperId(key)) typingExtra[key] = value;
    else if (typeof value === "boolean") typing[key] = value;
  }
  return { typing, extra, typingExtra, ...(rawPopup !== undefined && { selectionPopup: parseSelectionPopupPrefs(rawPopup) }) };
}

const sortKeys = (record: Readonly<Record<string, unknown>>): Record<string, unknown> => Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

/** The exact bytes every app writes: version 1, every helper, the selection popup when set, keys sorted, two-space indent. */
export function serializeEditorPrefs(prefs: EditorPrefs): string {
  const typing = sortKeys({ ...prefs.typingExtra, ...prefs.typing });
  const popup = prefs.selectionPopup && { selectionPopup: formatSelectionPopupPrefs(prefs.selectionPopup) };
  return `${JSON.stringify(sortKeys({ ...prefs.extra, ...popup, typing, version: EDITOR_PREFS_VERSION }), null, 2)}\n`;
}

/** Load-modify-save over editor-prefs.json, one at a time; a read-only file is never written. */
export class EditorPrefsStore {
  private readonly queue = new KeyedQueue();
  private readonly listeners = createListeners<TypingHelpers>();
  private last: TypingHelpers | undefined;
  private readonly popupListeners = createListeners<SelectionPopupPrefs>();
  private lastPopup: SelectionPopupPrefs | undefined;

  constructor(private readonly port: EditorPrefsPort, private readonly logger: ILogger) {}

  /** The helpers on disk, defaults for a missing or unreadable file. */
  async typing(): Promise<TypingHelpers> {
    const prefs = await this.load();
    this.last = prefs.typing;
    return prefs.typing;
  }

  /** Writes the helpers, keeping every other key; nothing is written while the file is read-only. */
  setTyping(next: TypingHelpers): Promise<void> {
    return this.queue.run("prefs", async () => {
      const prefs = await this.load();
      if (prefs.readOnlyReason !== undefined) return;
      if (isSameTypingHelpers(prefs.typing, next)) { this.last = next; return; }
      const typing = Object.fromEntries(TYPING_HELPER_IDS.map((id) => [id, next[id]])) as Record<TypingHelperId, boolean>;
      try {
        await this.port.write(serializeEditorPrefs({ ...prefs, typing }));
      } catch (error) {
        await this.logger.error(MODULE, error, { action: "write editor-prefs.json" });
        throw error;
      }
      this.last = typing;
      this.listeners.emit(typing);
    });
  }

  /** The selection popup's settings on disk, defaults for a missing or unreadable file or key. */
  async selectionPopup(): Promise<SelectionPopupPrefs> {
    const popup = (await this.load()).selectionPopup ?? DEFAULT_SELECTION_POPUP;
    this.lastPopup = popup;
    return popup;
  }

  /** Writes the selection popup's settings, keeping every other key; nothing is written while the file is read-only. */
  setSelectionPopup(next: SelectionPopupPrefs): Promise<void> {
    return this.queue.run("prefs", async () => {
      const prefs = await this.load();
      if (prefs.readOnlyReason !== undefined) return;
      if (prefs.selectionPopup && isSameSelectionPopup(prefs.selectionPopup, next)) { this.lastPopup = next; return; }
      const selectionPopup = parseSelectionPopupPrefs(formatSelectionPopupPrefs(next));
      try {
        await this.port.write(serializeEditorPrefs({ ...prefs, selectionPopup }));
      } catch (error) {
        await this.logger.error(MODULE, error, { action: "write editor-prefs.json" });
        throw error;
      }
      this.lastPopup = selectionPopup;
      this.popupListeners.emit(selectionPopup);
    });
  }

  /** Runs after this store writes the selection popup's settings, and after `changed()` finds new ones. */
  onSelectionPopupChange(listener: (popup: SelectionPopupPrefs) => void): () => void {
    return this.popupListeners.add(listener);
  }

  /** Runs after this store writes, and after `changed()` finds new values. */
  onChange(listener: (typing: TypingHelpers) => void): () => void {
    return this.listeners.add(listener);
  }

  /** Reads the file again after a change outside this store (sync, the other app); listeners hear only a real difference. */
  changed(): Promise<void> {
    return this.queue.run("prefs", async () => {
      const prefs = await this.load();
      const { typing } = prefs;
      const popup = prefs.selectionPopup ?? DEFAULT_SELECTION_POPUP;
      if (!this.lastPopup || !isSameSelectionPopup(this.lastPopup, popup)) {
        this.lastPopup = popup;
        this.popupListeners.emit(popup);
      }
      if (this.last && isSameTypingHelpers(this.last, typing)) return;
      this.last = typing;
      this.listeners.emit(typing);
    });
  }

  private async load(): Promise<EditorPrefs> {
    let text: string | null;
    try {
      text = await this.port.read();
    } catch (error) {
      const reason = `editor-prefs.json could not be read: ${formatError(error)}`;
      await this.logger.log("WARN", MODULE, "Editor preferences are unreadable", { reason });
      return { ...DEFAULT_PREFS, readOnlyReason: reason };
    }
    const prefs = parseEditorPrefs(text);
    if (prefs.readOnlyReason !== undefined) await this.logger.log("WARN", MODULE, "Editor preferences are read-only", { reason: prefs.readOnlyReason });
    return prefs;
  }
}
