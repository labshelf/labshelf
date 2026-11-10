// Keeps the page's open source editors by project and file: reveals a line in one, saves or reloads every editor of a project, and the helpers editors share for loading from disk and explicit saves.
import { Annotation, type ChangeSet, type Text } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { ILogger } from "../../../index.js";
import type { TextChange } from "../../authority.js";

export interface OpenEditor {
  /** Scrolls to the zero-based line and selects it. */
  revealLine(line: number): void;
  /** Writes pending edits now; resolves whether the file is saved afterwards. */
  flush(): Promise<boolean>;
  /**
   * Takes the file's text on disk: replaces a clean editor's text without marking it dirty, and merges the change into
   * unsaved edits elsewhere in the text; resolves false when the change overlaps unsaved edits, which it then keeps as they are.
   */
  reload(): Promise<boolean>;
}

const editors = new Map<string, OpenEditor>();
const pending = new Map<string, number>();
// INVARIANT: encodeURIComponent escapes ":", so the project part of a key never runs into its path part.
const projectPrefix = (projectId: string): string => `${encodeURIComponent(projectId)}:`;
const keyOf = (projectId: string, path: string): string => `${projectPrefix(projectId)}${encodeURIComponent(path)}`;
const editorsOf = (projectId: string): OpenEditor[] =>
  [...editors].filter(([key]) => key.startsWith(projectPrefix(projectId))).map(([, editor]) => editor);

/** Adds a mounted editor and applies a reveal asked for before it mounted; returns the call that removes it. */
export function registerOpenEditor(projectId: string, path: string, editor: OpenEditor): () => void {
  const key = keyOf(projectId, path);
  editors.set(key, editor);
  const line = pending.get(key);
  if (line !== undefined) {
    pending.delete(key);
    editor.revealLine(line);
  }
  return () => { if (editors.get(key) === editor) editors.delete(key); };
}

/** Reveals the line in the file's editor; when none is mounted yet (its tab is still loading), the editor reveals it on mount. */
export function showInOpenEditor(projectId: string, path: string, line: number): void {
  const key = keyOf(projectId, path);
  const editor = editors.get(key);
  if (editor) editor.revealLine(line);
  else pending.set(key, line);
}

/** Saves the pending edits of every open editor of the project; resolves whether all of them are saved. */
export async function writeProjectEditors(projectId: string): Promise<boolean> {
  const saved = await Promise.all(editorsOf(projectId).map((editor) => editor.flush()));
  return saved.every(Boolean);
}

/** Reloads the file's open editor from disk after another page wrote the file; resolves false when the editor kept overlapping unsaved edits. */
export async function reloadOpenEditor(projectId: string, path: string): Promise<boolean> {
  return (await editors.get(keyOf(projectId, path))?.reload()) ?? true;
}

/** Reloads every open editor of the project from disk. */
export async function refreshProjectEditors(projectId: string): Promise<void> {
  await Promise.all(editorsOf(projectId).map((editor) => editor.reload()));
}

const LOAD_MODULE = "editor.mount";

/** Marks the transaction that loads the file's text from disk, which is not an edit to save. */
export const fromDisk = Annotation.define<boolean>();

/** What loading a file's text from disk needs of the editor's dependencies. */
export interface DiskSourceDeps {
  projectId: string;
  /** Project-relative path of the file. */
  path: string;
  files: { read(path: string): Promise<string> };
  logger: ILogger;
}

/** The one span where `after` differs from `before`, as a change of `before`. */
function changedSpan(before: string, after: string): TextChange {
  const shorter = Math.min(before.length, after.length);
  let start = 0;
  while (start < shorter && before[start] === after[start]) start += 1;
  let end = 0;
  while (end < shorter - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end += 1;
  return { from: start, to: before.length - end, insert: after.slice(start, after.length - end) };
}

/**
 * Rebases the change from `saved` to `disk` onto `local`, the saved text with unsaved edits.
 * @returns the change in offsets of `local`, or undefined when it overlaps the unsaved edits.
 */
export function rebaseDiskChange(saved: string, local: string, disk: string): TextChange | undefined {
  const theirs = changedSpan(saved, disk);
  const ours = changedSpan(saved, local);
  if (theirs.to <= ours.from) return theirs;
  if (theirs.from < ours.to) return undefined;
  const shift = ours.insert.length - (ours.to - ours.from);
  return { from: theirs.from + shift, to: theirs.to + shift, insert: theirs.insert };
}

/**
 * Replaces the editor's text with the file on disk. A shared file's change goes into its shared text, so the peers get it
 * and its file writer saves it; a local file's change is not an edit to save. Given the last `saved` text, unsaved edits
 * are kept: the file's change merges into them as an edit to save, or, when it overlaps them, is left out.
 * @returns false when the file's change overlapped unsaved edits and was left out.
 */
export async function loadFromDisk(view: EditorView, { files, path, projectId, logger }: DiskSourceDeps, onLoaded: (disk: string) => void, saved?: string): Promise<boolean> {
  try {
    const disk = await files.read(path);
    const lineBreak = view.state.lineBreak;
    const current = view.state.doc.sliceString(0, undefined, lineBreak);
    if (disk === current) { onLoaded(disk); return true; }
    if (saved === undefined || saved === current) {
      onLoaded(disk);
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: disk }, annotations: fromDisk.of(true) });
      return true;
    }
    const lf = (text: string): string => (lineBreak === "\n" ? text : text.split(lineBreak).join("\n"));
    const change = rebaseDiskChange(lf(saved), view.state.doc.toString(), lf(disk));
    if (!change) {
      void logger.log("WARN", LOAD_MODULE, "kept unsaved edits that overlap a change of the file on disk", { projectId, path });
      return false;
    }
    onLoaded(disk);
    view.dispatch({ changes: change });
    return true;
  } catch (error) {
    void logger.error(LOAD_MODULE, error, { action: "reloadSource", projectId, path });
    return true;
  }
}

export interface HelperUpdates {
  /** Sends the change from the previous text to `doc`. */
  changed(changes: ChangeSet, doc: Text): void;
  /** Tells the helper the file was written, `explicit` when the user asked to save; the next edit carries the whole text again. */
  saved(explicit?: boolean): void;
}

export interface WriteScheduler {
  /** Marks the file dirty and restarts the save delay. */
  changed(): void;
  /** Writes now when dirty; resolves whether the file is clean afterwards. */
  flush(): Promise<boolean>;
  dirty(): boolean;
}

/** Tells the helper which write the user asked for with Mod-s. */
export function explicitSaves(helperEdits: HelperUpdates): { written(): void; flush(save: Pick<WriteScheduler, "flush" | "dirty">): void } {
  // INVARIANT: set only while a Mod-s flush runs, so exactly the write it causes reaches the helper as an explicit save.
  let requested = false;
  return {
    written() { helperEdits.saved(requested); requested = false; },
    // Writing a dirty file already asks the helper for a full build; a clean or shared file asks for it here.
    flush(save) {
      const wasDirty = save.dirty();
      requested = wasDirty;
      void save.flush().then((clean) => {
        requested = false;
        if (clean && !wasDirty) helperEdits.saved(true);
      });
    },
  };
}
