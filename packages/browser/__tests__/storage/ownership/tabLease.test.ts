import { acquireTabLease, tabLeaseName, takeOverTabLease } from "../../../src/storage/ownership";

type Callback = (lock: { name: string } | null) => Promise<unknown>;
interface Holder { reject(error: unknown): void }

/** A Web Locks fake with exclusive locks, `ifAvailable` and `steal`, enough for one profile's tabs. */
function installFakeLocks(): void {
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

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("tab lease", () => {
  beforeEach(installFakeLocks);

  it("names the lock by library and share", () => {
    expect(tabLeaseName("lib-1", "share-2")).toBe("labshelf:collab:lib-1:share-2");
  });

  it("owns a free name and reports busy to the next tab", async () => {
    const first = await acquireTabLease("n");
    expect(first.kind).toBe("owned");
    expect(await acquireTabLease("n")).toEqual({ kind: "busy" });
    expect((await acquireTabLease("other")).kind).toBe("owned");
  });

  it("frees the name on release", async () => {
    const first = await acquireTabLease("n");
    if (first.kind !== "owned") { throw new Error("expected owned"); }
    await first.lease.release();
    expect((await acquireTabLease("n")).kind).toBe("owned");
  });

  it("fires onLost on the old owner when another tab takes over", async () => {
    const first = await acquireTabLease("n");
    if (first.kind !== "owned") { throw new Error("expected owned"); }
    const lost = jest.fn();
    first.lease.onLost(lost);
    const second = await takeOverTabLease("n");
    await flush();
    expect(lost).toHaveBeenCalledTimes(1);
    expect(await acquireTabLease("n")).toEqual({ kind: "busy" });
    await first.lease.release();
    await second.release();
    expect((await acquireTabLease("n")).kind).toBe("owned");
  });
});
