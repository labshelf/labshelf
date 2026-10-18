/** Verifies reading a project folder, its root file names and its optional files over the library file-system port. */
import { posixPathOps } from "../../../../src/library/index";
import { readOptionalText, readProject, rootFileNames } from "../../../../src/writing/project/folder/index";
import { fakeLogger } from "../../../support/fakeLogger";
import { MemoryLibraryFs } from "../../../support/memoryLibraryFs";

function setup(files: Record<string, string>) {
  const fs = new MemoryLibraryFs();
  for (const [file, text] of Object.entries(files)) { fs.files.set(file, new TextEncoder().encode(text)); fs.dirs.add(file.slice(0, file.lastIndexOf("/"))); }
  const logger = fakeLogger();
  return { fs, logger, ctx: { fs, paths: posixPathOps, logger } };
}

describe("readProject", () => {
  it("is ready with the main named in labshelf.yaml", async () => {
    const { ctx } = setup({ "/p/labshelf.yaml": "id: a\nformat: latex\nmain: x.tex\n" });
    expect(await readProject(ctx, "/p", "library")).toMatchObject({
      kind: "ready", folder: "/p", location: "library", main: "x.tex", settings: { id: "a" },
    });
  });

  it("is ready with a detected main when the yaml names none", async () => {
    const { ctx } = setup({
      "/p/labshelf.yaml": "id: a\nformat: latex\n", "/p/chapter.tex": "text", "/p/paper.tex": "\\documentclass{article}",
    });
    expect(await readProject(ctx, "/p", "external")).toMatchObject({ kind: "ready", location: "external", main: "paper.tex" });
  });

  it("is ready with an undefined main when nothing is detected", async () => {
    const { ctx } = setup({ "/p/labshelf.yaml": "id: a\nformat: typst\n" });
    const entry = await readProject(ctx, "/p", "library");
    expect(entry.kind === "ready" && entry.main).toBeUndefined();
  });

  it("is broken and logs a warning when labshelf.yaml is missing", async () => {
    const { ctx, fs, logger } = setup({});
    await fs.mkdir("/p");
    expect(await readProject(ctx, "/p", "library")).toEqual({
      kind: "broken", folder: "/p", location: "library", reason: "labshelf.yaml is missing",
    });
    expect(logger.logs.map((entry) => entry.level)).toEqual(["WARN"]);
  });

  it("is broken when the folder does not exist", async () => {
    const { ctx } = setup({});
    expect(await readProject(ctx, "/gone", "external")).toMatchObject({ kind: "broken", reason: "folder not found" });
  });

  it("is broken with the offending key when the yaml is invalid", async () => {
    const { ctx } = setup({ "/p/labshelf.yaml": "id: a\nformat: word\n" });
    const entry = await readProject(ctx, "/p", "library");
    expect(entry.kind === "broken" && entry.reason).toMatch(/^labshelf\.yaml: format must be/);
  });
});

describe("rootFileNames", () => {
  it("lists files at the root and leaves out folders and links", async () => {
    const { ctx, fs } = setup({ "/p/a.tex": "x", "/p/sub/b.tex": "x" });
    fs.symlinks.add("/p/link");
    expect((await rootFileNames(ctx, "/p")).sort()).toEqual(["a.tex"]);
  });
});

describe("readOptionalText", () => {
  it("reads a file, and reads a missing file or a folder as undefined", async () => {
    const { fs } = setup({ "/p/a.txt": "hello" });
    expect(await readOptionalText(fs, "/p/a.txt")).toBe("hello");
    expect(await readOptionalText(fs, "/p/missing.txt")).toBeUndefined();
    expect(await readOptionalText(fs, "/p")).toBeUndefined();
  });
});
