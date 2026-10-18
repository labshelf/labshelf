// Fans file change events out to the listeners the editor registers.
import type { Disposable, FileChange } from "./types";

export function createFileChangeEmitter() {
  const listeners = new Set<(changes: FileChange[]) => void>();
  return {
    event(listener: (changes: FileChange[]) => void): Disposable {
      listeners.add(listener);
      return { dispose: () => { listeners.delete(listener); } };
    },
    fire(changes: FileChange[]): void {
      for (const listener of [...listeners]) listener(changes);
    },
  };
}
