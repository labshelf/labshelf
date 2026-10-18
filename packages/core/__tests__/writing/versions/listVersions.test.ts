/** Verifies listing the version snapshots a project folder holds. */
import { posixPathOps } from "../../../src/library/index";
import { listVersions } from "../../../src/writing/versions/index";
import { fakeLogger } from "../../support/fakeLogger";
import { MemoryLibraryFs } from "../../support/memoryLibraryFs";

const ROOT = "/p/.labshelf/versions";

async function snapshot(fs: MemoryLibraryFs, slug: string, name: string, created: string): Promise<void> {
  await fs.writeText(`${ROOT}/${slug}/version.json`, JSON.stringify({ name, created }));
}

describe("listVersions", () => {
  it("returns an empty list when the project has no versions", async () => {
    const fs = new MemoryLibraryFs();
    await fs.ensureDir("/p");
    expect(await listVersions({ fs, paths: posixPathOps, logger: fakeLogger() }, "/p")).toEqual([]);
  });

  it("sorts by creation time with joined paths, and skips temp folders and malformed snapshots with a warning", async () => {
    const fs = new MemoryLibraryFs();
    const logger = fakeLogger();
    await snapshot(fs, "rebuttal", "rebuttal", "2026-10-20T10:00:00.000Z");
    await snapshot(fs, "submitted", "submitted", "2026-10-15T10:00:00.000Z");
    await fs.ensureDir(`${ROOT}/.half.tmp-ab12`);
    await fs.writeText(`${ROOT}/broken/version.json`, "{nope");
    await fs.ensureDir(`${ROOT}/empty`);
    const versions = await listVersions({ fs, paths: posixPathOps, logger }, "/p");
    expect(versions.map((v) => v.slug)).toEqual(["submitted", "rebuttal"]);
    expect(versions[0]).toEqual({
      slug: "submitted", name: "submitted", created: "2026-10-15T10:00:00.000Z",
      pdfPath: `${ROOT}/submitted/paper.pdf`, sourcesDir: `${ROOT}/submitted/sources`,
    });
    expect(logger.logs.filter((l) => l.level === "WARN")).toHaveLength(2);
  });
});
