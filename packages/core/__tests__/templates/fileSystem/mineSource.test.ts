/** Verifies the My templates source reading <library>/templates. */
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { cleanupTempDirs, makeTempDir } from "../../support/tempDirs";
import { fakeLogger } from "../../support/fakeLogger";
import { NodeLibraryFileSystem } from "../../../src/library/node/index.js";
import { createMineSource } from "../../../src/templates/index.js";

const nodeFs = new NodeLibraryFileSystem();

afterEach(cleanupTempDirs);

const manifest = (id: string) =>
  `schema: 1\nid: ${id}\nname: Name ${id}\ndescription: A template.\ncategory: article\nformat: latex\nengine: pdflatex\nmain: main.tex\nlicense: MIT\nauthors: [Jane Doe]\n`;

async function put(root: string, rel: string, content: string): Promise<void> {
  const target = path.join(root, rel);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content);
}

async function setup() {
  const libraryRoot = await makeTempDir();
  const logger = fakeLogger();
  return { libraryRoot, logger, source: createMineSource({ fs: nodeFs, paths: path, libraryRoot, logger }) };
}

describe("createMineSource", () => {
  it("has id mine", async () => {
    expect((await setup()).source.id).toBe("mine");
  });

  it("lists nothing when the library has no templates folder", async () => {
    expect(await (await setup()).source.list()).toEqual({ entries: [], fromCache: false });
  });

  it("lists each valid template with source mine", async () => {
    const { libraryRoot, source } = await setup();
    await put(libraryRoot, "templates/alpha/template.yaml", manifest("alpha"));
    await put(libraryRoot, "templates/beta/template.yaml", manifest("beta"));
    const { entries } = await source.list();
    expect(entries.map((e) => e.id).sort()).toEqual(["alpha", "beta"]);
    expect(entries.every((e) => e.source === "mine")).toBe(true);
    expect(entries.find((e) => e.id === "alpha")).toMatchObject({ name: "Name alpha", format: "latex", main: "main.tex" });
  });

  it("skips and logs an invalid manifest, naming its folder", async () => {
    const { libraryRoot, source, logger } = await setup();
    await put(libraryRoot, "templates/good/template.yaml", manifest("good"));
    await put(libraryRoot, "templates/broken/template.yaml", "schema: 1\nid: broken\n");
    expect((await source.list()).entries.map((e) => e.id)).toEqual(["good"]);
    expect(JSON.stringify(logger.logs) + JSON.stringify(logger.errors)).toContain("broken");
  });

  it("skips and logs a manifest whose id differs from its folder name", async () => {
    const { libraryRoot, source, logger } = await setup();
    await put(libraryRoot, "templates/folder-a/template.yaml", manifest("other-id"));
    expect((await source.list()).entries).toEqual([]);
    expect(JSON.stringify(logger.logs) + JSON.stringify(logger.errors)).toContain("folder-a");
  });

  it("returns only the files under files/, relative to it", async () => {
    const { libraryRoot, source } = await setup();
    await put(libraryRoot, "templates/alpha/template.yaml", manifest("alpha"));
    await put(libraryRoot, "templates/alpha/files/main.tex", "\\documentclass{article}");
    await put(libraryRoot, "templates/alpha/files/sections/intro.tex", "intro");
    await put(libraryRoot, "templates/alpha/preview/thumbnail.png", "png");
    const [entry] = (await source.list()).entries;
    const files = await source.files(entry!);
    expect(files.map((f) => f.path)).toEqual(["main.tex", "sections/intro.tex"]);
    expect(Buffer.from(files[0]!.bytes).toString()).toBe("\\documentclass{article}");
  });

  it.each(["a/b", "..", "../x", "a/../b"])("rejects the entry id %s without touching the disk", async (id) => {
    const { libraryRoot, source } = await setup();
    await put(libraryRoot, "templates/alpha/template.yaml", manifest("alpha"));
    const [entry] = (await source.list()).entries;
    const spy = jest.spyOn(nodeFs, "listDir");
    const before = spy.mock.calls.length;
    await expect(source.files({ ...entry!, id })).rejects.toThrow();
    expect(spy.mock.calls.length).toBe(before);
    spy.mockRestore();
  });

  it("never reports a cached list", async () => {
    const { libraryRoot, source } = await setup();
    await put(libraryRoot, "templates/alpha/template.yaml", manifest("alpha"));
    expect((await source.list()).fromCache).toBe(false);
  });

  it("carries each entry's file paths relative to files/", async () => {
    const { libraryRoot, source } = await setup();
    await put(libraryRoot, "templates/alpha/template.yaml", manifest("alpha"));
    await put(libraryRoot, "templates/alpha/files/main.tex", "x");
    await put(libraryRoot, "templates/alpha/files/sections/intro.tex", "y");
    await put(libraryRoot, "templates/alpha/preview/thumbnail.png", "png");
    expect((await source.list()).entries[0]!.files?.slice().sort()).toEqual(["main.tex", "sections/intro.tex"]);
  });

  it("reads preview/thumbnail.png as the thumbnail", async () => {
    const { libraryRoot, source } = await setup();
    await put(libraryRoot, "templates/alpha/template.yaml", manifest("alpha"));
    await put(libraryRoot, "templates/alpha/preview/thumbnail.png", "png");
    const [entry] = (await source.list()).entries;
    expect(Buffer.from((await source.thumbnail(entry!))!).toString()).toBe("png");
  });

  it("returns undefined when the thumbnail is missing", async () => {
    const { libraryRoot, source } = await setup();
    await put(libraryRoot, "templates/alpha/template.yaml", manifest("alpha"));
    const [entry] = (await source.list()).entries;
    expect(await source.thumbnail(entry!)).toBeUndefined();
  });
});
