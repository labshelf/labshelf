// The editors' preferences (the source editor's typing helpers and selection popup, the notes' bubble) as the open panels see them: the open library's editor-prefs.json store, followed across library
// root changes, with the file watched so a change made by the other app (or a sync tool) reaches every panel.
import * as vscode from "vscode";

import type { EditorPopupKey, EditorPrefsStore, SelectionPopupPrefs, TypingHelpers } from "@labshelf/core";

/** What the panels use: the current values, a write and a subscription that survives a change of library. */
export interface EditorPrefsHost {
  typing(): Promise<TypingHelpers | undefined>;
  setTyping(next: TypingHelpers): Promise<void>;
  /** Runs after a write by this app, after a change on disk, and when another library opens. */
  onChange(listener: (typing: TypingHelpers) => void): () => void;
  selectionPopup(): Promise<SelectionPopupPrefs | undefined>;
  setSelectionPopup(next: SelectionPopupPrefs): Promise<void>;
  /** Runs after a write of the selection popup's settings, after a change on disk, and when another library opens. */
  onSelectionPopupChange(listener: (popup: SelectionPopupPrefs) => void): () => void;
  /** The notes editor's bubble settings, followed the same way. */
  notePopup(): Promise<SelectionPopupPrefs | undefined>;
  setNotePopup(next: SelectionPopupPrefs): Promise<void>;
  onNotePopupChange(listener: (popup: SelectionPopupPrefs) => void): () => void;
}

export interface EditorPrefsHostDeps {
  /** The open library's store and root folder; undefined with no library open. */
  current(): { store: EditorPrefsStore; root: string } | undefined;
  onDidChangeRoot: vscode.Event<unknown>;
}

/** The file inside the library root, as the pattern the watcher takes. */
const PREFS_PATTERN = ".research/editor-prefs.json";

/** Follows the library's store and watches its prefs file; one disposable undoes both. */
function watchPrefs(
  { store, root }: { store: EditorPrefsStore; root: string },
  emit: (typing: TypingHelpers) => void,
  emitPopup: (key: EditorPopupKey) => (popup: SelectionPopupPrefs) => void,
): vscode.Disposable {
  const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(root), PREFS_PATTERN));
  const changed = (): void => { void store.changed(); };
  const unsubscribe = store.onChange(emit);
  const unsubscribePopup = store.onSelectionPopupChange(emitPopup("selectionPopup"));
  const unsubscribeNotePopup = store.onNotePopupChange(emitPopup("notePopup"));
  return vscode.Disposable.from({ dispose: unsubscribe }, { dispose: unsubscribePopup }, { dispose: unsubscribeNotePopup }, watcher, watcher.onDidChange(changed), watcher.onDidCreate(changed), watcher.onDidDelete(changed));
}

export function createEditorPrefsHost(deps: EditorPrefsHostDeps): EditorPrefsHost & vscode.Disposable {
  const listeners = new Set<(typing: TypingHelpers) => void>();
  let binding: vscode.Disposable | undefined;
  const emit = (typing: TypingHelpers): void => { for (const listener of [...listeners]) { listener(typing); } };
  const popupListeners = { selectionPopup: new Set<(popup: SelectionPopupPrefs) => void>(), notePopup: new Set<(popup: SelectionPopupPrefs) => void>() } satisfies Record<EditorPopupKey, unknown>;
  const emitPopup = (key: EditorPopupKey) => (popup: SelectionPopupPrefs): void => { for (const listener of [...popupListeners[key]]) { listener(popup); } };
  const subscribe = (key: EditorPopupKey, listener: (popup: SelectionPopupPrefs) => void): (() => void) => {
    popupListeners[key].add(listener);
    return () => { popupListeners[key].delete(listener); };
  };

  const bind = (announce: boolean): void => {
    binding?.dispose();
    binding = undefined;
    const library = deps.current();
    if (!library) { return; }
    binding = watchPrefs(library, emit, emitPopup);
    // Panels open on another library's values now.
    if (announce) { void library.store.typing().then(emit); void library.store.selectionPopup().then(emitPopup("selectionPopup")); void library.store.notePopup().then(emitPopup("notePopup")); }
  };

  bind(false);
  const rootChange = deps.onDidChangeRoot(() => bind(true));

  return {
    typing: async () => await deps.current()?.store.typing(),
    setTyping: async (next) => { await deps.current()?.store.setTyping(next); },
    onChange(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    selectionPopup: async () => await deps.current()?.store.selectionPopup(),
    setSelectionPopup: async (next) => { await deps.current()?.store.setSelectionPopup(next); },
    onSelectionPopupChange: (listener) => subscribe("selectionPopup", listener),
    notePopup: async () => await deps.current()?.store.notePopup(),
    setNotePopup: async (next) => { await deps.current()?.store.setNotePopup(next); },
    onNotePopupChange: (listener) => subscribe("notePopup", listener),
    dispose() {
      binding?.dispose();
      rootChange.dispose();
      listeners.clear();
      popupListeners.selectionPopup.clear();
      popupListeners.notePopup.clear();
    },
  };
}
