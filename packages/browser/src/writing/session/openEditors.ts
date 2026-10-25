// Keeps the page's mounted source editors by project and file, so the outline can scroll one and a history restore can save and reload them.
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
