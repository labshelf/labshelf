// Tells a project's open history pages that one of its edits became a history entry, so their timeline follows saves.
const listeners = new Map<string, Set<() => void>>();

/** Calls the listener after each edit entry recorded for the project; returns the call that stops it. */
export function onUpdateRecorded(projectId: string, listener: () => void): () => void {
  const set = listeners.get(projectId) ?? new Set();
  listeners.set(projectId, set);
  set.add(listener);
  return () => { set.delete(listener); };
}

export function sendUpdateRecorded(projectId: string): void {
  for (const listener of listeners.get(projectId) ?? []) listener();
}
