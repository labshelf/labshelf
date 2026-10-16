// Tests that a paper folder's listing is ordered, filtered, described and reports failures through the logger.
import { MemoryLibraryFs } from "../../support/memoryLibraryFs";
import { fakeLogger } from "../../support/fakeLogger";
import { listPaperFiles } from "../../../src/library/paperFiles";
import type { PaperFilesState } from "../../../src/library/paperFiles";

const DIR = "/lib/papers/ml/p1";

class TimedFs extends MemoryLibraryFs {
  readonly mtimes = new Map<string, number>();
  override async stat(target: string) {
    const base = await super.stat(target);
    return base && { ...base, mtimeMs: this.mtimes.get(target) ?? 0 };
  }
}

async function seeded(): Promise<TimedFs> {
  const fs = new TimedFs();
  await fs.writeText(`${DIR}/paper.pdf`, "%PDF-1234");
  await fs.writeText(`${DIR}/metadata.yaml`, "title: T\n");
  await fs.writeText(`${DIR}/bib.bib`, "@article{}");
  await fs.writeText(`${DIR}/.keep`, "");
  await fs.writeText(`${DIR}/.hidden/inner.txt`, "x");
  await fs.writeText(`${DIR}/zeta.txt`, "zz");
  await fs.writeText(`${DIR}/alpha.csv`, "a,b");
  await fs.writeText(`${DIR}/sub-b/x.txt`, "x");
  await fs.writeText(`${DIR}/sub-a/x.txt`, "x");
  return fs;
}

function ready(state: PaperFilesState) {
  if (state.status !== "ready") { throw new Error(`expected ready, got ${state.message}`); }
  return state.files;
}

describe("listPaperFiles", () => {
  it("lists paper.pdf first, then files by name, then folders by name", async () => {
    const files = ready(await listPaperFiles(await seeded(), DIR, undefined, fakeLogger()));
    expect(files.map((f) => f.name)).toEqual(["paper.pdf", "alpha.csv", "zeta.txt", "sub-a", "sub-b"]);
  });

  it("hides metadata.yaml, bib.bib and every dot entry", async () => {
    const names = ready(await listPaperFiles(await seeded(), DIR, undefined, fakeLogger())).map((f) => f.name);
    for (const hidden of ["metadata.yaml", "bib.bib", ".keep", ".hidden"]) { expect(names).not.toContain(hidden); }
  });

  it("gives files a size and folders none, with kind and ISO modified time", async () => {
    const fs = await seeded();
    fs.mtimes.set(`${DIR}/alpha.csv`, Date.UTC(2026, 9, 15, 10, 0, 0));
    fs.mtimes.set(`${DIR}/sub-a`, Date.UTC(2026, 0, 2));
    const files = ready(await listPaperFiles(fs, DIR, undefined, fakeLogger()));
    expect(files.find((f) => f.name === "alpha.csv")).toEqual({ name: "alpha.csv", kind: "file", size: 3, modified: "2026-10-15T10:00:00.000Z" });
    const folder = files.find((f) => f.name === "sub-a")!;
    expect(folder).toMatchObject({ kind: "folder", modified: "2026-01-02T00:00:00.000Z" });
    expect(folder).not.toHaveProperty("size");
  });

  it("joins stored descriptions by name and leaves others without one", async () => {
    const files = ready(await listPaperFiles(await seeded(), DIR, { "alpha.csv": "Raw data", "sub-a": "Source code", "gone.txt": "stale" }, fakeLogger()));
    expect(files.find((f) => f.name === "alpha.csv")?.description).toBe("Raw data");
    expect(files.find((f) => f.name === "sub-a")?.description).toBe("Source code");
    expect(files.find((f) => f.name === "zeta.txt")).not.toHaveProperty("description");
    expect(files.map((f) => f.name)).not.toContain("gone.txt");
  });

  it("returns an empty ready list for a folder with only hidden entries", async () => {
    const fs = new TimedFs();
    await fs.writeText(`${DIR}/metadata.yaml`, "title: T\n");
    expect(await listPaperFiles(fs, DIR, undefined, fakeLogger())).toEqual({ status: "ready", files: [] });
  });

  it("logs the paper path and returns a failed state when the listing throws", async () => {
    const fs = await seeded();
    fs.unreadable.add(DIR);
    const logger = fakeLogger();
    const state = await listPaperFiles(fs, DIR, undefined, logger);
    expect(state.status).toBe("failed");
    expect(state.status === "failed" && state.message).toContain("EACCES");
    const logged = JSON.stringify([...logger.logs, ...logger.errors]);
    expect(logged).toContain(DIR);
  });
});
