// A registry of listeners that are added, removed and called with one emitted value.

export interface Listeners<T = void> {
  /** @returns an unsubscribe function; calling it again does nothing */
  add(listener: (value: T) => void): () => void;
  /** Calls the listeners in the order added, on the live set; a throwing listener stops the loop and propagates. */
  emit(value: T): void;
  clear(): void;
}

export function createListeners<T = void>(): Listeners<T> {
  const set = new Set<(value: T) => void>();
  return {
    add(listener) {
      set.add(listener);
      return () => { set.delete(listener); };
    },
    emit(value) {
      for (const listener of set) listener(value);
    },
    clear() {
      set.clear();
    },
  };
}
