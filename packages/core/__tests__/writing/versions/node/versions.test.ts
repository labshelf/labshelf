// Tests marking a version snapshot and listing the snapshots of a project folder on the real disk.
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { listVersions, markVersion } from "../../../../src/writing/versions/node/index";
import { fakeLogger } from "../../../support/fakeLogger";
import { cleanupTempDirs, makeTempDir } from "../../../support/tempDirs";

afterEach(cleanupTempDirs);

async function write(file: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text);
}

async function project(): Promise<{ folder: string; pdf: string }> {
  const folder = await makeTempDir();
  await write(path.join(folder, "main.tex"), "main");
  await write(path.join(folder, "sections", "intro.tex"), "intro");
  await write(path.join(folder, "refs.bib"), "bib");
  await write(path.join(folder, ".git", "HEAD"), "ref");
  await write(path.join(folder, ".labshelf", "state.json"), "{}");
  const pdf = path.join(folder, "main.pdf");
  await write(pdf, "%PDF one");
  return { folder, pdf };
}

const at = (iso: string): Date => new Date(iso);

describe("markVersion", () => {
  it("copies nested sources and the PDF, leaving out .labshelf, .git and the PDF from the sources", async () => {
    const { folder, pdf } = await project();
    const dir = await markVersion({ folder, pdfPath: pdf, name: "Camera-ready", now: at("2026-10-15T10:00:00Z") }, fakeLogger());
    expect(dir).toBe(path.join(folder, ".labshelf", "versions", "camera-ready"));
    expect(await fs.readFile(path.join(dir, "paper.pdf"), "utf8")).toBe("%PDF one");
    expect(await fs.readFile(path.join(dir, "sources", "sections", "intro.tex"), "utf8")).toBe("intro");
    expect(await fs.readdir(path.join(dir, "sources"))).toEqual(["main.tex", "refs.bib", "sections"]);
    expect(JSON.parse(await fs.readFile(path.join(dir, "version.json"), "utf8")))
      .toEqual({ name: "Camera-ready", created: "2026-10-15T10:00:00.000Z" });
  });

  it("replaces an existing version of the same slug", async () => {
    const { folder, pdf } = await project();
    const logger = fakeLogger();
    await markVersion({ folder, pdfPath: pdf, name: "submitted", now: at("2026-10-15T10:00:00Z") }, logger);
    await fs.rm(path.join(folder, "refs.bib"));
    await write(pdf, "%PDF two");
    const dir = await markVersion({ folder, pdfPath: pdf, name: "Submitted", now: at("2026-10-16T10:00:00Z") }, logger);
    expect(await fs.readdir(path.join(dir, "sources"))).toEqual(["main.tex", "sections"]);
    expect(await fs.readFile(path.join(dir, "paper.pdf"), "utf8")).toBe("%PDF two");
    expect((await listVersions(folder, logger)).map((v) => v.name)).toEqual(["Submitted"]);
  });

  it("rejects a name without a slug and a missing PDF, writing nothing", async () => {
    const { folder, pdf } = await project();
    await expect(markVersion({ folder, pdfPath: pdf, name: "   ", now: new Date() }, fakeLogger())).rejects.toThrow("no letter or digit");
    await expect(markVersion({ folder, pdfPath: path.join(folder, "gone.pdf"), name: "x", now: new Date() }, fakeLogger())).rejects.toThrow("without the built PDF");
    await expect(fs.stat(path.join(folder, ".labshelf", "versions"))).rejects.toThrow();
  });

  it("leaves no temp folder and keeps the previous version after a failed snapshot", async () => {
    const { folder, pdf } = await project();
    await markVersion({ folder, pdfPath: pdf, name: "submitted", now: at("2026-10-15T10:00:00Z") }, fakeLogger());
    const copy = jest.spyOn(fs, "copyFile").mockRejectedValueOnce(new Error("disk full"));
    await expect(markVersion({ folder, pdfPath: pdf, name: "submitted", now: new Date() }, fakeLogger())).rejects.toThrow("Cannot mark version");
    copy.mockRestore();
    const versions = path.join(folder, ".labshelf", "versions");
    expect(await fs.readdir(versions)).toEqual(["submitted"]);
    expect(await fs.readFile(path.join(versions, "submitted", "paper.pdf"), "utf8")).toBe("%PDF one");
  });

  it("logs the folder, slug and file count", async () => {
    const { folder, pdf } = await project();
    const log = jest.fn(async () => {});
    await markVersion({ folder, pdfPath: pdf, name: "Rebuttal", now: new Date() }, { log, error: jest.fn() });
    expect(log).toHaveBeenCalledWith("INFO", "writing/versions", expect.any(String), { folder, slug: "rebuttal", files: 3 });
  });
});

describe("listVersions", () => {
  it("returns an empty list when the project has no versions", async () => {
    expect(await listVersions(await makeTempDir(), fakeLogger())).toEqual([]);
  });

  it("sorts by creation time with absolute paths, and skips temp folders and malformed snapshots with a warning", async () => {
    const { folder, pdf } = await project();
    const logger = fakeLogger();
    await markVersion({ folder, pdfPath: pdf, name: "rebuttal", now: at("2026-10-20T10:00:00Z") }, logger);
    await markVersion({ folder, pdfPath: pdf, name: "submitted", now: at("2026-10-15T10:00:00Z") }, logger);
    const root = path.join(folder, ".labshelf", "versions");
    await fs.mkdir(path.join(root, ".half.tmp-ab12"));
    await write(path.join(root, "broken", "version.json"), "{nope");
    await fs.mkdir(path.join(root, "empty"));
    const versions = await listVersions(folder, logger);
    expect(versions.map((v) => v.slug)).toEqual(["submitted", "rebuttal"]);
    expect(versions[0]).toEqual({
      slug: "submitted", name: "submitted", created: "2026-10-15T10:00:00.000Z",
      pdfPath: path.join(root, "submitted", "paper.pdf"), sourcesDir: path.join(root, "submitted", "sources"),
    });
    expect(logger.logs.filter((l) => l.level === "WARN")).toHaveLength(2);
  });
});
