// What a reader panel follows besides its webview: the reader settings, the auto theme and its paper's notes.qmd (as a text document and as a file), so the reader re-pushes them after an edit from anywhere.
import * as vscode from "vscode";
import { createPaperFiles, normalizeReaderPrefs, type ReaderHostController, type ReaderPrefs } from "@labshelf/core";
import { onAutoReaderThemeChange } from "./shell.js";

const FOLLOW_DEBOUNCE_MS = 100;

const READER_CONFIG_SECTION = "labshelf.reader";

const PREF_KEYS: readonly (keyof ReaderPrefs)[] = [
  "vimKeys", "defaultZoom", "toolbarAutoHide", "restorePosition", "hoverPreviews", "hoverDelayMs", "citationStyle",
];

/**
 * Settings are user-editable JSON, so every value is validated (shared normalizeReaderPrefs) and falls back to its default.
 * @returns the current reader preferences.
 */
export function getReaderPrefs(): ReaderPrefs {
  const cfg = vscode.workspace.getConfiguration(READER_CONFIG_SECTION);
  const raw: Record<string, unknown> = {};
  for (const key of PREF_KEYS) { raw[key] = cfg.get<unknown>(key); }
  return normalizeReaderPrefs(raw);
}

/**
 * Whether the reader opens beside the current editor (ViewColumn.Two) or full-width in the active group (default).
 * @returns the view column to open the reader panel in.
 */
export function getReaderViewColumn(): vscode.ViewColumn {
  const beside = vscode.workspace.getConfiguration(READER_CONFIG_SECTION).get<unknown>("openBeside");
  return beside === true ? vscode.ViewColumn.Two : vscode.ViewColumn.Active;
}

/**
 * Passes the OS theme and the reader settings to the controller whenever they change.
 * @returns the subscriptions, which the panel disposes with itself.
 */
export function followReaderSettings(controller: ReaderHostController): vscode.Disposable[] {
  return [
    onAutoReaderThemeChange((theme) => { controller.onAutoThemeChange(theme); }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(READER_CONFIG_SECTION)) { controller.onPrefsChange(); }
    }),
  ];
}

/** Calls onChange FOLLOW_DEBOUNCE_MS after the last change of the notes document or file; dispose stops it and cancels a pending call. */
export function followNotesFile(notesUri: vscode.Uri, onChange: () => void): vscode.Disposable {
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const changed = (): void => {
    if (disposed) return;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => { timer = undefined; if (!disposed) onChange(); }, FOLLOW_DEBOUNCE_MS);
  };
  const key = notesUri.toString();
  const fileName = notesUri.path.slice(notesUri.path.lastIndexOf("/") + 1);
  const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.joinPath(notesUri, ".."), fileName));
  const subscriptions: vscode.Disposable[] = [
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.toString() === key && event.contentChanges.length > 0) changed();
    }),
    watcher.onDidChange(changed),
    watcher.onDidCreate(changed),
    watcher.onDidDelete(changed),
    watcher,
  ];
  return {
    dispose(): void {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      for (const subscription of subscriptions) subscription.dispose();
    },
  };
}

/**
 * Follows the notes.qmd of the paper in paperDir, whichever editor changes it.
 * @returns the subscription; dispose stops it.
 */
export function followPaperNotes(paperDir: string, onChange: () => void): vscode.Disposable {
  return followNotesFile(createPaperFiles(vscode.Uri.file(paperDir), vscode.Uri.joinPath).notes, onChange);
}
