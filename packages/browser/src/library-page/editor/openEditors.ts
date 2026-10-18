// Keeps the page's mounted source editors by project and file, so the sidebar outline can scroll one to a heading.
export interface RevealableEditor {
  /** Scrolls to the zero-based line and selects it. */
  revealLine(line: number): void;
}

const editors = new Map<string, RevealableEditor>();
const pending = new Map<string, number>();
const keyOf = (projectId: string, path: string): string => `${encodeURIComponent(projectId)}:${encodeURIComponent(path)}`;

/** Adds a mounted editor and applies a reveal asked for before it mounted; returns the call that removes it. */
export function registerOpenEditor(projectId: string, path: string, editor: RevealableEditor): () => void {
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
export function revealInOpenEditor(projectId: string, path: string, line: number): void {
  const key = keyOf(projectId, path);
  const editor = editors.get(key);
  if (editor) editor.revealLine(line);
  else pending.set(key, line);
}
