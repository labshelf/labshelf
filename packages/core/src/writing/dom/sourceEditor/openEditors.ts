// Keeps the page's open source editors by project and file: reveals a line in one, saves or reloads every editor of a project, and the helpers editors share for loading from disk and explicit saves.
import { Annotation, type ChangeSet, type Text } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { ILogger } from "../../../index.js";

export interface OpenEditor {
  /** Scrolls to the zero-based line and selects it. */
  revealLine(line: number): void;
  /** Writes pending edits now; resolves whether the file is saved afterwards. */
  flush(): Promise<boolean>;
  /** Replaces the editor's text with the file's text on disk, without marking it dirty. */
  reload(): Promise<void>;
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

/**
 * Replaces the editor's text with the file on disk. A shared file's change goes into its shared text, so the peers get it
 * and its file writer saves it; a local file's change is not an edit to save.
 */
export async function loadFromDisk(view: EditorView, { files, path, projectId, logger }: DiskSourceDeps, onLoaded: (disk: string) => void): Promise<void> {
  try {
    const disk = await files.read(path);
    onLoaded(disk);
    if (disk === view.state.doc.sliceString(0, undefined, view.state.lineBreak)) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: disk }, annotations: fromDisk.of(true) });
  } catch (error) {
    void logger.error(LOAD_MODULE, error, { action: "reloadSource", projectId, path });
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
