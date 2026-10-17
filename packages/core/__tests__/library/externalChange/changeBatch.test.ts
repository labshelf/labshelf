import { processChangeBatch, type ConflictCopy, type ILogger } from "@labshelf/core";

const copy: ConflictCopy = { paperId: "p", original: "/lib/papers/p/metadata.yaml", copy: "/lib/papers/p/m (conflicted copy).yaml", tool: "dropbox" };

function setup(overrides: { scan?: () => Promise<ConflictCopy[]>; present?: boolean } = {}) {
  const order: string[] = [];
  const logs: Array<{ level: string; message: string; context?: Record<string, unknown> }> = [];
  const logger = { log: jest.fn(async (level: string, _m: string, message: string, context?: Record<string, unknown>) => { logs.push({ level, message, ...(context ? { context } : {}) }); }) } as unknown as ILogger;
  const deps = {
    logger,
    isRootPresent: async () => overrides.present ?? true,
    scanConflicts: overrides.scan ?? (async () => { order.push("scan"); return [copy]; }),
    reindex: async () => { order.push("reindex"); },
  };
  return { deps, order, logs };
}

describe("processChangeBatch", () => {
  it("scans conflict copies, logs how many are unresolved, then re-indexes", async () => {
    const { deps, order, logs } = setup();
    await processChangeBatch(deps);
    expect(order).toEqual(["scan", "reindex"]);
    expect(logs.find((l) => l.level === "INFO")?.context).toMatchObject({ unresolved: 1 });
  });

  it("re-indexes even when the conflict scan fails, and logs a WARN", async () => {
    const { deps, order, logs } = setup({ scan: async () => { throw new Error("boom"); } });
    deps.reindex = async () => { order.push("reindex"); };
    await processChangeBatch(deps);
    expect(order).toEqual(["reindex"]);
    expect(logs.some((l) => l.level === "WARN" && l.context?.["message"] === "boom")).toBe(true);
  });

  it("does nothing while the library root is missing, so an unmounted folder never empties the library", async () => {
    const { deps, order } = setup({ present: false });
    await processChangeBatch(deps);
    expect(order).toEqual([]);
  });
});
