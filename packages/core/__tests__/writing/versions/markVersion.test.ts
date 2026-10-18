/** Verifies marking a version snapshot: what it copies, replacing a slug, and leaving no half-written version on failure. */
import { listVersions, markVersion } from "@labshelf/core";

import { MemoryLibraryFs } from "../../support/memoryLibraryFs";
import { filesUnder, memoryCatalog, readText, writeTree, type MemoryCatalog } from "../../support/memoryProjectCatalog";

const FOLDER = "/p";
const PDF = `${FOLDER}/main.pdf`;
const VERSIONS = `${FOLDER}/.labshelf/versions`;
const at = (iso: string): Date => new Date(iso);

/** Fails the write of any file whose path ends with `failOn`. */
class FailingWriteFs extends MemoryLibraryFs {
  failOn: string | undefined;
  override async writeFile(file: string, content: Uint8Array): Promise<void> {
    if (this.failOn !== undefined && file.endsWith(this.failOn)) { throw new Error("disk full"); }
    await super.writeFile(file, content);
  }
}

async function project(fs: MemoryLibraryFs = new MemoryLibraryFs()): Promise<MemoryCatalog> {
  const context = memoryCatalog(fs);
  await writeTree(fs, FOLDER, {
    "main.tex": "main", "sections/intro.tex": "intro", "refs.bib": "bib",
    ".git/HEAD": "ref", ".labshelf/state.json": "{}", "main.pdf": "%PDF one",
  });
  return context;
}

describe("markVersion", () => {
  it("copies nested sources and the PDF, leaving out .labshelf, .git and the PDF from the sources", async () => {
    const context = await project();
    const dir = await markVersion(context, { folder: FOLDER, pdfPath: PDF, name: "Camera-ready", now: at("2026-10-15T10:00:00Z") });
    expect(dir).toBe(`${VERSIONS}/camera-ready`);
    expect(filesUnder(context.fs, dir)).toEqual(["paper.pdf", "sources/main.tex", "sources/refs.bib", "sources/sections/intro.tex", "version.json"]);
    expect(readText(context.fs, `${dir}/paper.pdf`)).toBe("%PDF one");
    expect(readText(context.fs, `${dir}/sources/sections/intro.tex`)).toBe("intro");
    expect(JSON.parse(readText(context.fs, `${dir}/version.json`))).toEqual({ name: "Camera-ready", created: "2026-10-15T10:00:00.000Z" });
  });

  it("replaces an existing version of the same slug", async () => {
    const context = await project();
    await markVersion(context, { folder: FOLDER, pdfPath: PDF, name: "submitted", now: at("2026-10-15T10:00:00Z") });
    await context.fs.deleteFile(`${FOLDER}/refs.bib`);
    await context.fs.writeText(PDF, "%PDF two");
    const dir = await markVersion(context, { folder: FOLDER, pdfPath: PDF, name: "Submitted", now: at("2026-10-16T10:00:00Z") });
    expect(filesUnder(context.fs, `${dir}/sources`)).toEqual(["main.tex", "sections/intro.tex"]);
    expect(readText(context.fs, `${dir}/paper.pdf`)).toBe("%PDF two");
    expect((await listVersions(context, FOLDER)).map((v) => v.name)).toEqual(["Submitted"]);
  });

  it("rejects a name without a slug and a missing PDF, writing nothing", async () => {
    const context = await project();
    const writes = context.fs.writes;
    await expect(markVersion(context, { folder: FOLDER, pdfPath: PDF, name: "   ", now: new Date() })).rejects.toThrow("no letter or digit");
    await expect(markVersion(context, { folder: FOLDER, pdfPath: `${FOLDER}/gone.pdf`, name: "x", now: new Date() })).rejects.toThrow("without the built PDF");
    expect(context.fs.writes).toBe(writes);
    expect(filesUnder(context.fs, VERSIONS)).toEqual([]);
  });

  it.each([["sections/intro.tex"], ["paper.pdf"], ["version.json"]])(
    "leaves no temp folder and keeps the earlier version when writing %s fails", async (failOn) => {
      const fs = new FailingWriteFs();
      const context = await project(fs);
      await markVersion(context, { folder: FOLDER, pdfPath: PDF, name: "submitted", now: at("2026-10-15T10:00:00Z") });
      const before = filesUnder(fs, VERSIONS);
      fs.failOn = failOn;
      await expect(markVersion(context, { folder: FOLDER, pdfPath: PDF, name: "submitted", now: new Date() })).rejects.toThrow("Cannot mark version");
      expect(filesUnder(fs, VERSIONS)).toEqual(before);
      expect(await fs.listDir(VERSIONS)).toEqual(["submitted"]);
      expect(readText(fs, `${VERSIONS}/submitted/paper.pdf`)).toBe("%PDF one");
      expect(context.logger.errors.length).toBeGreaterThan(0);
    });

  it("logs the folder, slug and file count", async () => {
    const context = await project();
    const log = jest.fn(async () => {});
    await markVersion({ ...context, logger: { log, error: jest.fn() } }, { folder: FOLDER, pdfPath: PDF, name: "Rebuttal", now: new Date() });
    expect(log).toHaveBeenCalledWith("INFO", "writing/versions", expect.any(String), { folder: FOLDER, slug: "rebuttal", files: 3 });
  });
});
