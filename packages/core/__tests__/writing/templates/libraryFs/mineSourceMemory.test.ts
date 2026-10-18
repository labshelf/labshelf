/** Verifies the My templates source and the index cache over an in-memory library, with no Node file system. */
import { createLibraryTemplateCache, createMineSource, posixPathOps } from "../../../../src/index.js";
import { fakeLogger } from "../../../support/fakeLogger";
import { MemoryLibraryFs } from "../../../support/memoryLibraryFs";

const manifest = (id: string) =>
  `schema: 1\nid: ${id}\nname: Name ${id}\ndescription: A template.\ncategory: article\nformat: latex\nengine: pdflatex\nmain: main.tex\nlicense: MIT\nauthors: [Jane Doe]\n`;

function setup() {
  const fs = new MemoryLibraryFs();
  const logger = fakeLogger();
  return { fs, logger, source: createMineSource({ fs, paths: posixPathOps, libraryRoot: "", logger }) };
}

describe("createMineSource over a memory library", () => {
  it("lists nothing without a templates folder", async () => {
    expect((await setup().source.list()).entries).toEqual([]);
  });

  it("lists templates with their files and reads files and thumbnail", async () => {
    const { fs, source } = setup();
    await fs.writeText("templates/alpha/template.yaml", manifest("alpha"));
    await fs.writeText("templates/alpha/files/main.tex", "main");
    await fs.writeText("templates/alpha/files/sections/intro.tex", "intro");
    await fs.writeFile("templates/alpha/preview/thumbnail.png", new Uint8Array([1, 2]));
    const [entry] = (await source.list()).entries;
    expect(entry).toMatchObject({ id: "alpha", source: "mine", files: ["main.tex", "sections/intro.tex"] });
    expect((await source.files(entry!)).map((file) => file.path)).toEqual(["main.tex", "sections/intro.tex"]);
    expect(Array.from((await source.thumbnail(entry!))!)).toEqual([1, 2]);
  });

  it("leaves out and logs a manifest whose id differs from its folder", async () => {
    const { fs, source, logger } = setup();
    await fs.writeText("templates/folder-a/template.yaml", manifest("other"));
    expect((await source.list()).entries).toEqual([]);
    expect(JSON.stringify(logger.errors)).toContain("folder-a");
  });

  it("refuses a file that is neither a file nor a folder", async () => {
    const { fs, source, logger } = setup();
    await fs.writeText("templates/alpha/template.yaml", manifest("alpha"));
    await fs.writeText("templates/alpha/files/main.tex", "main");
    fs.symlinks.add("templates/alpha/files/link.tex");
    const [entry] = (await source.list()).entries;
    expect(entry?.files).toBeUndefined();
    await expect(source.files({ ...entry!, id: "alpha" })).rejects.toThrow("link.tex");
    expect(logger.errors.length).toBeGreaterThan(0);
  });

  it("refuses an id that leaves the templates folder", async () => {
    const { source } = setup();
    const entry = { id: "a/b", source: "mine" } as never;
    await expect(source.files(entry)).rejects.toThrow("not a template id");
    expect(await source.thumbnail(entry)).toBeUndefined();
  });
});

describe("createLibraryTemplateCache over a memory library", () => {
  it("round-trips an index and its etag, and drops the etag when rewritten without one", async () => {
    const cache = createLibraryTemplateCache({ fs: new MemoryLibraryFs(), paths: posixPathOps, libraryRoot: "" });
    await cache.writeIndex("community", { body: "[1]", etag: "e1" });
    expect(await cache.readIndex("community")).toEqual({ body: "[1]", etag: "e1" });
    await cache.writeIndex("community", { body: "[2]" });
    expect(await cache.readIndex("community")).toEqual({ body: "[2]" });
    expect(await cache.readIndex("universe")).toBeUndefined();
  });

  it("refuses a thumbnail key that leaves the thumbnails folder", async () => {
    const cache = createLibraryTemplateCache({ fs: new MemoryLibraryFs(), paths: posixPathOps, libraryRoot: "" });
    await expect(cache.writeThumbnail("../x.png", new Uint8Array([1]))).rejects.toThrow("not a thumbnail cache key");
  });
});
