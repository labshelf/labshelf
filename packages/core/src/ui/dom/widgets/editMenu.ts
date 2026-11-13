// The clipboard rows every right-click menu of a text surface starts with (the source editor, the notes editor, the PDF reader), drawn by showMenu so the
// menu looks like the rest of the app instead of the system's.
import type { MenuEntry } from "./menu.js";
import { showToast } from "./toast.js";

/** What a surface can do with its text; an absent action leaves its row out, and `hasSelection` false disables Cut and Copy. */
export interface EditMenuActions {
  hasSelection: boolean;
  /** Removes the selection after copying it; absent on read-only text. */
  cut?(): void;
  copy(): void;
  /** Inserts the clipboard's text in place of the selection; absent on read-only text. */
  paste?(text: string): void;
  selectAll?(): void;
}

const isMac = (): boolean => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** The shortcut of `key` as the platform writes it: ⌘C on a Mac, Ctrl+C elsewhere. */
export function formatModKey(key: string): string {
  return isMac() ? `⌘${key}` : `Ctrl+${key}`;
}

/**
 * Copies or cuts the page's selection through the browser, so the surface's own copy handler (CodeMirror's, ProseMirror's) writes what it would on the
 * keyboard shortcut; the focus is already back on the surface when a menu row runs.
 */
export function runClipboardCommand(command: "copy" | "cut"): void {
  if (!document.execCommand(command)) showToast(`Use ${formatModKey(command === "copy" ? "C" : "X")} to ${command}.`, "info");
}

/** Reads the clipboard's text; a host that refuses (no permission) gets a hint to use the keyboard. */
async function readClipboard(): Promise<string | undefined> {
  try {
    return await navigator.clipboard.readText();
  } catch {
    showToast(`Use ${formatModKey("V")} to paste.`, "info");
    return undefined;
  }
}

/** Cut, Copy, Paste and Select all, with their shortcuts as hints. */
export function editMenuEntries(actions: EditMenuActions): MenuEntry[] {
  const { cut, paste, selectAll } = actions;
  return [
    ...(cut ? [{ label: "Cut", hint: formatModKey("X"), disabled: !actions.hasSelection, onSelect: cut }] : []),
    { label: "Copy", hint: formatModKey("C"), disabled: !actions.hasSelection, onSelect: actions.copy },
    ...(paste ? [{ label: "Paste", hint: formatModKey("V"), onSelect: () => { void readClipboard().then((text) => { if (text) paste(text); }); } }] : []),
    ...(selectAll ? [{ label: "Select all", hint: formatModKey("A"), onSelect: selectAll }] : []),
  ];
}
