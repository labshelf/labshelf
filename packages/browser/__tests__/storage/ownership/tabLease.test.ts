import { acquireTabLease, tabLeaseName, takeOverTabLease } from "../../../src/storage/ownership";
import { installFakeLocks } from "../../support/fakeLocks";

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
});
