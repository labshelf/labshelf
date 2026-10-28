// Tests version snapshots: the version file, slugs from names, listing versions and marking a new one.
import { posixPathOps } from "../../../src/path/index";
import { listVersions, addProjectVersion, parseVersionFile, serializeVersionFile, deriveVersionSlug } from "../../../src/writing/project/index";
import { fakeLogger } from "../../support/fakeLogger";
import { MemoryLibraryFs } from "../../support/memoryLibraryFs";
import { filesUnder, memoryCatalog, readText, writeTree, type MemoryCatalog } from "../../support/memoryProjectCatalog";

const CREATED = "2026-10-15T21:40:12.000Z";

describe("parseVersionFile", () => {
  it("reads a valid file with the folder slug", () => {
    expect(parseVersionFile("camera-ready", JSON.stringify({ name: "Camera-ready", created: CREATED })))
      .toEqual({ slug: "camera-ready", name: "Camera-ready", created: CREATED });
  });

  it("round-trips through serializeVersionFile", () => {
    const text = serializeVersionFile({ name: "Réponse 2", created: CREATED });
    expect(parseVersionFile("reponse-2", text)).toEqual({ slug: "reponse-2", name: "Réponse 2", created: CREATED });
  });

  it.each([
    ["not json", "{nope"],
    ["an array", "[]"],
    ["null", "null"],
    ["a missing name", JSON.stringify({ created: CREATED })],
    ["an empty name", JSON.stringify({ name: " ", created: CREATED })],
    ["a non-string name", JSON.stringify({ name: 3, created: CREATED })],
    ["a missing created", JSON.stringify({ name: "x" })],
    ["an invalid created", JSON.stringify({ name: "x", created: "yesterday" })],
  ])("returns undefined for %s", (_label, text) => {
    expect(parseVersionFile("x", text)).toBeUndefined();
  });
});

describe("deriveVersionSlug", () => {
  it.each([
    ["submitted", "submitted"],
    ["Camera-ready", "camera-ready"],
    ["Réponse 2", "reponse-2"],
    ["  Rebuttal   round #2!  ", "rebuttal-round-2"],
    ["../x", "x"],
    ["a/b\\c", "a-b-c"],
  ])("turns %j into %j", (name, slug) => {
    expect(deriveVersionSlug(name)).toBe(slug);
  });

  it.each(["", "   ", "---", "../", "论文"])("returns undefined for %j", (name) => {
    expect(deriveVersionSlug(name)).toBeUndefined();
  });

  it("caps the slug at 60 characters without a trailing dash", () => {
    const slug = deriveVersionSlug(`${"a".repeat(59)} b`);
    expect(slug).toBe("a".repeat(59));
    expect(deriveVersionSlug("x".repeat(100))).toHaveLength(60);
  });
});

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

describe("addProjectVersion", () => {
  it("copies nested sources and the PDF, leaving out .labshelf, .git and the PDF from the sources", async () => {
    const context = await project();
    const dir = await addProjectVersion(context, { folder: FOLDER, pdfPath: PDF, name: "Camera-ready", now: at("2026-10-15T10:00:00Z") });
    expect(dir).toBe(`${VERSIONS}/camera-ready`);
    expect(filesUnder(context.fs, dir)).toEqual(["paper.pdf", "sources/main.tex", "sources/refs.bib", "sources/sections/intro.tex", "version.json"]);
    expect(readText(context.fs, `${dir}/paper.pdf`)).toBe("%PDF one");
    expect(readText(context.fs, `${dir}/sources/sections/intro.tex`)).toBe("intro");
    expect(JSON.parse(readText(context.fs, `${dir}/version.json`))).toEqual({ name: "Camera-ready", created: "2026-10-15T10:00:00.000Z" });
  });

  it("replaces an existing version of the same slug", async () => {
    const context = await project();
    await addProjectVersion(context, { folder: FOLDER, pdfPath: PDF, name: "submitted", now: at("2026-10-15T10:00:00Z") });
    await context.fs.deleteFile(`${FOLDER}/refs.bib`);
    await context.fs.writeText(PDF, "%PDF two");
    const dir = await addProjectVersion(context, { folder: FOLDER, pdfPath: PDF, name: "Submitted", now: at("2026-10-16T10:00:00Z") });
    expect(filesUnder(context.fs, `${dir}/sources`)).toEqual(["main.tex", "sections/intro.tex"]);
    expect(readText(context.fs, `${dir}/paper.pdf`)).toBe("%PDF two");
    expect((await listVersions(context, FOLDER)).map((v) => v.name)).toEqual(["Submitted"]);
  });

  it("rejects a name without a slug and a missing PDF, writing nothing", async () => {
    const context = await project();
    const writes = context.fs.writes;
    await expect(addProjectVersion(context, { folder: FOLDER, pdfPath: PDF, name: "   ", now: new Date() })).rejects.toThrow("no letter or digit");
    await expect(addProjectVersion(context, { folder: FOLDER, pdfPath: `${FOLDER}/gone.pdf`, name: "x", now: new Date() })).rejects.toThrow("without the built PDF");
    expect(context.fs.writes).toBe(writes);
    expect(filesUnder(context.fs, VERSIONS)).toEqual([]);
  });

  it.each([["sections/intro.tex"], ["paper.pdf"], ["version.json"]])(
    "leaves no temp folder and keeps the earlier version when writing %s fails", async (failOn) => {
      const fs = new FailingWriteFs();
      const context = await project(fs);
      await addProjectVersion(context, { folder: FOLDER, pdfPath: PDF, name: "submitted", now: at("2026-10-15T10:00:00Z") });
      const before = filesUnder(fs, VERSIONS);
      fs.failOn = failOn;
      await expect(addProjectVersion(context, { folder: FOLDER, pdfPath: PDF, name: "submitted", now: new Date() })).rejects.toThrow("Cannot mark version");
      expect(filesUnder(fs, VERSIONS)).toEqual(before);
      expect(await fs.listDir(VERSIONS)).toEqual(["submitted"]);
      expect(readText(fs, `${VERSIONS}/submitted/paper.pdf`)).toBe("%PDF one");
      expect(context.logger.errors.length).toBeGreaterThan(0);
    });

  it("logs the folder, slug and file count", async () => {
    const context = await project();
    const log = jest.fn(async () => {});
    await addProjectVersion({ ...context, logger: { log, error: jest.fn() } }, { folder: FOLDER, pdfPath: PDF, name: "Rebuttal", now: new Date() });
    expect(log).toHaveBeenCalledWith("INFO", "writing/versions", expect.any(String), { folder: FOLDER, slug: "rebuttal", files: 3 });
  });
});
