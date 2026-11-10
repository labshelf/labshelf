// The source editor's preferences as the open panels see them: the open library's editor-prefs.json store, followed across library
// root changes, with the file watched so a change made by the other app (or a sync tool) reaches every panel.
import * as vscode from "vscode";

import type { EditorPrefsStore, TypingHelpers } from "@labshelf/core";

/** What the panels use: the current values, a write and a subscription that survives a change of library. */
export interface EditorPrefsHost {
  typing(): Promise<TypingHelpers | undefined>;
  setTyping(next: TypingHelpers): Promise<void>;
  /** Runs after a write by this app, after a change on disk, and when another library opens. */
  onChange(listener: (typing: TypingHelpers) => void): () => void;
}

export interface EditorPrefsHostDeps {
  /** The open library's store and root folder; undefined with no library open. */
  current(): { store: EditorPrefsStore; root: string } | undefined;
  onDidChangeRoot: vscode.Event<unknown>;
}

/** The file inside the library root, as the pattern the watcher takes. */
const PREFS_PATTERN = ".research/editor-prefs.json";

export function createEditorPrefsHost(deps: EditorPrefsHostDeps): EditorPrefsHost & vscode.Disposable {
  const listeners = new Set<(typing: TypingHelpers) => void>();
  let binding: vscode.Disposable | undefined;
  const emit = (typing: TypingHelpers): void => { for (const listener of [...listeners]) { listener(typing); } };

  const bind = (announce: boolean): void => {
    binding?.dispose();
    binding = undefined;
    const library = deps.current();
    if (!library) { return; }
    const { store, root } = library;
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(root), PREFS_PATTERN));
    const changed = (): void => { void store.changed(); };
    const unsubscribe = store.onChange(emit);
    binding = vscode.Disposable.from({ dispose: unsubscribe }, watcher, watcher.onDidChange(changed), watcher.onDidCreate(changed), watcher.onDidDelete(changed));
    // Panels open on another library's values now.
    if (announce) { void store.typing().then(emit); }
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
    dispose() {
      binding?.dispose();
      rootChange.dispose();
      listeners.clear();
    },
  };
}
