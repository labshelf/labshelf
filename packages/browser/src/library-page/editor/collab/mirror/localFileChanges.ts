// Tells this page's running share mirrors which library files the page itself wrote, so a shared project picks them up at once.
// TRAP: browser storage has no watcher and a folder is rescanned only every 30 s, so a page write reaches the share only through this.

type Listener = (paths: readonly string[]) => void;

const listeners = new Set<Listener>();

/** Reports files the page created, changed, renamed or deleted, by their "/"-separated library paths (both paths of a rename). */
export function reportLocalFileChanges(paths: readonly string[]): void {
  listeners.forEach((listener) => listener(paths));
}

export function onLocalFileChanges(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
