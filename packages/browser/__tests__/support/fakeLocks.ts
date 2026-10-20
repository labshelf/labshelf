// Fake Web Locks for tests of the tab lease: exclusive locks with `ifAvailable` and `steal`.
type Callback = (lock: { name: string } | null) => Promise<unknown>;
interface Holder { reject(error: unknown): void }

/** A Web Locks fake with exclusive locks, `ifAvailable` and `steal`, enough for one profile's tabs. */
export function installFakeLocks(): void {
  const held = new Map<string, Holder>();
  const request = (name: string, options: { ifAvailable?: boolean; steal?: boolean }, callback: Callback) =>
    new Promise((resolve, reject) => {
      const current = held.get(name);
      if (current && options.ifAvailable) { void callback(null).then(resolve, reject); return; }
      if (current && !options.steal) { throw new Error("the fake does not queue waiting requests"); }
      if (current) { held.delete(name); current.reject(new DOMException("The lock was stolen", "AbortError")); }
      const holder: Holder = { reject };
      held.set(name, holder);
      void callback({ name }).then(
        (value) => { if (held.get(name) === holder) { held.delete(name); resolve(value); } },
        (error) => { if (held.get(name) === holder) { held.delete(name); reject(error); } },
      );
    });
  Object.defineProperty(navigator, "locks", { value: { request }, configurable: true });
}
