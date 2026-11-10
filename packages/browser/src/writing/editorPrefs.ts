// The source editor's preferences (typing helpers) of the open library: one store per library file system, kept in
// .research/editor-prefs.json, which the VS Code extension shares.
import { EditorPrefsStore, type ILogger, type LibraryFileSystem } from "@labshelf/core";
import { createEditorPrefsPort } from "../storage";

const stores = new WeakMap<LibraryFileSystem, EditorPrefsStore>();

/**
 * @returns the library's store, created with the first call. A change made by the other app arrives through the file, which the page reads
 * again whenever it shows or gets the focus (the bridge's `changed` batches do not reach the page), so an open editor follows it.
 */
export function editorPrefsOf(fs: LibraryFileSystem, logger: ILogger): EditorPrefsStore {
  const existing = stores.get(fs);
  if (existing) return existing;
  const store = new EditorPrefsStore(createEditorPrefsPort(fs), logger);
  stores.set(fs, store);
  const reread = (): void => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    void store.changed().catch((error: unknown) => void logger.error("writing/editorPrefs", error, { action: "reread editor-prefs.json" }));
  };
  if (typeof window !== "undefined") window.addEventListener("focus", reread);
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", reread);
  return store;
}
