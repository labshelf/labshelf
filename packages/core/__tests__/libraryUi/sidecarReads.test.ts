import { createSidecarReader } from "../../src/libraryUi/sidecarReads";
import type { ILogger } from "../../src/ports";

function logger(): ILogger & { log: jest.Mock } {
  return { log: jest.fn().mockResolvedValue(undefined), error: jest.fn().mockResolvedValue(undefined) };
}

const sidecars: Record<string, { annotations: unknown[]; reading?: { page: number; updatedAt: string } }> = {
  a: { annotations: [{}, {}], reading: { page: 4, updatedAt: "2026-01-01T00:00:00.000Z" } },
  b: { annotations: [] },
};
const load = async (id: string): Promise<never> => {
  const found = sidecars[id];
  if (!found) throw new Error("no sidecar");
  return found as never;
};

describe("createSidecarReader", () => {
  it("reads stats for the readable papers and logs the others with their id", async () => {
    const log = logger();
    const stats = await createSidecarReader(load, log, "ui/test").statsOf([{ id: "a" }, { id: "b" }, { id: "gone" }]);
    expect(stats).toEqual({ a: { annotations: 2, lastPage: 4, lastRead: "2026-01-01T00:00:00.000Z" }, b: { annotations: 0 } });
    expect(log.log).toHaveBeenCalledWith("WARN", "ui/test", "Sidecar could not be read for the list", { paperId: "gone", message: "Error: no sidecar" });
  });

  it("returns undefined stats for one unreadable paper", async () => {
    expect(await createSidecarReader(load, logger(), "ui/test").statsFor("gone")).toBeUndefined();
  });

  it("reads an unreadable sidecar as having no annotations, and logs it", async () => {
    const log = logger();
    const reader = createSidecarReader(load, log, "ui/test");
    expect((await reader.summaryOf("a")).annotations).toHaveLength(2);
    expect(await reader.summaryOf("gone")).toEqual({ annotations: [] });
    expect(log.log).toHaveBeenCalledWith("WARN", "ui/test", "Sidecar could not be read; showing no annotations", expect.objectContaining({ paperId: "gone" }));
  });
});
