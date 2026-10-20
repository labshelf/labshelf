// Fake Web Locks for tests of the tab lease: exclusive locks with a FIFO wait queue, `ifAvailable`, `steal` and `signal`.
type Callback = (lock: { name: string } | null) => Promise<unknown>;
interface RequestOptions { ifAvailable?: boolean; steal?: boolean; signal?: AbortSignal }
interface Holder { reject(error: unknown): void }

export interface FakeLocks {
  /** Frees a held lock as a closed page does: the holder's request never settles. */
  kill(name: string): void;
}

/** Installs a Web Locks fake with exclusive locks, enough for one profile's tabs. */
export function installFakeLocks(): FakeLocks {
  const held = new Map<string, Holder>();
  const queues = new Map<string, Array<() => void>>();
  const free = (name: string, holder: Holder): boolean => {
    if (held.get(name) !== holder) { return false; }
    held.delete(name);
    queues.get(name)?.shift()?.();
    return true;
  };
  const grant = (name: string, callback: Callback, resolve: (value: unknown) => void, reject: (error: unknown) => void): void => {
    const holder: Holder = { reject };
    held.set(name, holder);
    void callback({ name }).then(
      (value) => { if (free(name, holder)) { resolve(value); } },
      (error) => { if (free(name, holder)) { reject(error); } },
    );
  };
  const enqueue = (name: string, signal: AbortSignal | undefined, waiter: () => void, reject: (error: unknown) => void): void => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const queue = queues.get(name) ?? [];
    queues.set(name, queue);
    const onAbort = (): void => { queue.splice(queue.indexOf(entry), 1); reject(signal?.reason); };
    const entry = (): void => { signal?.removeEventListener("abort", onAbort); waiter(); };
    signal?.addEventListener("abort", onAbort, { once: true });
    queue.push(entry);
  };
  const request = (name: string, options: RequestOptions, callback: Callback) =>
    new Promise((resolve, reject) => {
      const current = held.get(name);
      if (current && options.ifAvailable) { void callback(null).then(resolve, reject); return; }
      if (current && !options.steal) { enqueue(name, options.signal, () => grant(name, callback, resolve, reject), reject); return; }
      if (current) { held.delete(name); current.reject(new DOMException("The lock was stolen", "AbortError")); }
      grant(name, callback, resolve, reject);
    });
  Object.defineProperty(navigator, "locks", { value: { request }, configurable: true });
  return {
    kill: (name) => {
      const holder = held.get(name);
      if (holder) { free(name, holder); }
    },
  };
}
