import { acquireTabLease, tabLeaseName, takeOverTabLease, waitForTabLease, type TabLease } from "../../src/storage";
import { installFakeLocks, type FakeLocks } from "../support/fakeLocks";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function owned(name: string): Promise<TabLease> {
  const result = await acquireTabLease(name);
  if (result.kind !== "owned") { throw new Error("expected owned"); }
  return result.lease;
}

describe("tab lease", () => {
  let locks: FakeLocks;
  beforeEach(() => { locks = installFakeLocks(); });

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

  it("fires onLost for a listener registered after the lease was already lost", async () => {
    const first = await acquireTabLease("n");
    if (first.kind !== "owned") { throw new Error("expected owned"); }
    const second = await takeOverTabLease("n");
    await flush();
    const lost = jest.fn();
    first.lease.onLost(lost);
    await flush();
    expect(lost).toHaveBeenCalledTimes(1);
    await second.release();
  });

  describe("waiting", () => {
    it("waits while another tab holds the lock and resolves when it releases", async () => {
      const first = await owned("n");
      const granted = jest.fn();
      const waiting = waitForTabLease("n", new AbortController().signal).then((lease) => { granted(); return lease; });
      await flush();
      expect(granted).not.toHaveBeenCalled();
      await first.release();
      const lease = await waiting;
      expect(await acquireTabLease("n")).toEqual({ kind: "busy" });
      await lease.release();
    });

    it("resolves when the holding page dies without releasing", async () => {
      await owned("n");
      const waiting = waitForTabLease("n", new AbortController().signal);
      locks.kill("n");
      await (await waiting).release();
      expect((await acquireTabLease("n")).kind).toBe("owned");
    });

    it("rejects with the AbortError when the signal aborts first", async () => {
      const first = await owned("n");
      const controller = new AbortController();
      const waiting = waitForTabLease("n", controller.signal);
      controller.abort();
      await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
      await first.release();
      expect((await acquireTabLease("n")).kind).toBe("owned");
    });

    it("fires onLost on a waited-for lease when another tab takes over", async () => {
      const lease = await waitForTabLease("n", new AbortController().signal);
      const lost = jest.fn();
      lease.onLost(lost);
      const second = await takeOverTabLease("n");
      await flush();
      expect(lost).toHaveBeenCalledTimes(1);
      await second.release();
    });
  });
});
