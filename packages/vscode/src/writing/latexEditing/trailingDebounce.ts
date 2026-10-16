// Runs a callback for a key once calls for that key have been quiet for a delay.
export interface KeyedDebounce<K> {
  call(key: K): void;
  dispose(): void;
}

export function trailingDebounce<K>(ms: number, run: (key: K) => void): KeyedDebounce<K> {
  const timers = new Map<K, ReturnType<typeof setTimeout>>();
  return {
    call(key) {
      clearTimeout(timers.get(key));
      timers.set(key, setTimeout(() => { timers.delete(key); run(key); }, ms));
    },
    dispose() {
      for (const timer of timers.values()) { clearTimeout(timer); }
      timers.clear();
    },
  };
}
