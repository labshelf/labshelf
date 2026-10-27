/** Verifies reading project folders: the file walk, edit times, one project and the library's list. */
import { posixPathOps } from "../../../src/path/index";
import {
  findLibraryProjectFolder, listBuildRootFileNames, listProjectFiles, listProjects, readLastModified, readOptionalText, readProject,
} from "../../../src/writing/project/projectReads";
import { fakeLogger } from "../../support/fakeLogger";
import { MemoryLibraryFs } from "../../support/memoryLibraryFs";

describe("listProjectFiles", () => {
  it("lists nested files relative to the folder, sorted, and skips hidden folders and node_modules", async () => {
    const fs = new MemoryLibraryFs();
    for (const file of ["a.tex", "sec/b.tex", ".git/c.tex", "node_modules/d/e.tex", ".hidden.tex", "sec/deep/z.tex"]) {
      await fs.writeText(`/p/${file}`, "x");
    }
    expect(await listProjectFiles({ fs, paths: posixPathOps }, "/p")).toEqual([".hidden.tex", "a.tex", "sec/b.tex", "sec/deep/z.tex"]);
  });

  it("rejects when the folder does not exist", async () => {
    await expect(listProjectFiles({ fs: new MemoryLibraryFs(), paths: posixPathOps }, "/gone")).rejects.toThrow(/not found/);
  });
});

describe("readLastModified", () => {
  it("is the newest mtime among source files and ignores other files", async () => {
    const fs = new MemoryLibraryFs();
    for (const [file, mtime] of [["main.tex", 100], ["sec/ref.BIB", 300], ["labshelf.yaml", 200], ["out.pdf", 900], [".git/x.tex", 800]] as const) {
      await fs.writeText(`/p/${file}`, "x");
      fs.mtimes.set(`/p/${file}`, mtime);
    }
    expect(await readLastModified({ fs, paths: posixPathOps }, "/p")).toBe(300);
  });

  it("is undefined when the folder has no source files", async () => {
    const fs = new MemoryLibraryFs();
    await fs.writeText("/p/out.pdf", "x");
    expect(await readLastModified({ fs, paths: posixPathOps }, "/p")).toBeUndefined();
  });
});

function folderWith(files: Record<string, string>) {
  const fs = new MemoryLibraryFs();
  for (const [file, text] of Object.entries(files)) { fs.files.set(file, new TextEncoder().encode(text)); fs.dirs.add(file.slice(0, file.lastIndexOf("/"))); }
  const logger = fakeLogger();
  return { fs, logger, ctx: { fs, paths: posixPathOps, logger } };
}

describe("readProject", () => {
  it("is ready with the main named in labshelf.yaml", async () => {
    const { ctx } = folderWith({ "/p/labshelf.yaml": "id: a\nformat: latex\nmain: x.tex\n" });
    expect(await readProject(ctx, "/p", "library")).toMatchObject({
      kind: "ready", folder: "/p", location: "library", main: "x.tex", settings: { id: "a" },
    });
  });

  it("is ready with a detected main when the yaml names none", async () => {
    const { ctx } = folderWith({
      "/p/labshelf.yaml": "id: a\nformat: latex\n", "/p/chapter.tex": "text", "/p/paper.tex": "\\documentclass{article}",
    });
    expect(await readProject(ctx, "/p", "external")).toMatchObject({ kind: "ready", location: "external", main: "paper.tex" });
  });

  it("is ready with an undefined main when nothing is detected", async () => {
    const { ctx } = folderWith({ "/p/labshelf.yaml": "id: a\nformat: typst\n" });
    const entry = await readProject(ctx, "/p", "library");
    expect(entry.kind === "ready" && entry.main).toBeUndefined();
  });

  it("is broken and logs a warning when labshelf.yaml is missing", async () => {
    const { ctx, fs, logger } = folderWith({});
    await fs.mkdir("/p");
    expect(await readProject(ctx, "/p", "library")).toEqual({
      kind: "broken", folder: "/p", location: "library", reason: "labshelf.yaml is missing",
    });
    expect(logger.logs.map((entry) => entry.level)).toEqual(["WARN"]);
  });

  it("is broken when the folder does not exist", async () => {
    const { ctx } = folderWith({});
    expect(await readProject(ctx, "/gone", "external")).toMatchObject({ kind: "broken", reason: "folder not found" });
  });

  it("is broken with the offending key when the yaml is invalid", async () => {
    const { ctx } = folderWith({ "/p/labshelf.yaml": "id: a\nformat: word\n" });
    const entry = await readProject(ctx, "/p", "library");
    expect(entry.kind === "broken" && entry.reason).toMatch(/^labshelf\.yaml: format must be/);
  });
});

describe("listBuildRootFileNames", () => {
  it("lists files at the root and leaves out folders and links", async () => {
    const { ctx, fs } = folderWith({ "/p/a.tex": "x", "/p/sub/b.tex": "x" });
    fs.symlinks.add("/p/link");
    expect((await listBuildRootFileNames(ctx, "/p")).sort()).toEqual(["a.tex"]);
  });
});

describe("readOptionalText", () => {
  it("reads a file, and reads a missing file or a folder as undefined", async () => {
    const { fs } = folderWith({ "/p/a.txt": "hello" });
    expect(await readOptionalText(fs, "/p/a.txt")).toBe("hello");
    expect(await readOptionalText(fs, "/p/missing.txt")).toBeUndefined();
    expect(await readOptionalText(fs, "/p")).toBeUndefined();
  });
});

async function libraryWithProjects() {
  const fs = new MemoryLibraryFs();
  await fs.writeText("/lib/projects/thesis/labshelf.yaml", "id: thesis\nformat: latex\n");
  await fs.writeText("/lib/projects/notes/labshelf.yaml", "id: notes\nformat: typst\n");
  await fs.writeText("/lib/projects/.hidden/labshelf.yaml", "id: hidden\nformat: latex\n");
  await fs.writeText("/lib/projects/stray.txt", "not a project");
  await fs.writeText("/outside/paper/labshelf.yaml", "id: paper\nformat: latex\n");
  return { fs, ctx: { fs, paths: posixPathOps, logger: fakeLogger() } };
}

describe("listProjects", () => {
  it("lists the library's own folders, then the registered folders as external", async () => {
    const { ctx } = await libraryWithProjects();
    const entries = await listProjects(ctx, "/lib", ["/outside/paper"]);
    expect(entries.map((entry) => [entry.folder, entry.location, entry.kind]).sort()).toEqual([
      ["/lib/projects/notes", "library", "ready"], ["/lib/projects/thesis", "library", "ready"], ["/outside/paper", "external", "ready"],
    ]);
    expect(entries.at(-1)?.location).toBe("external");
  });

  it("lists nothing when the projects folder is missing", async () => {
    const { ctx } = await libraryWithProjects();
    expect(await listProjects(ctx, "/empty", [])).toEqual([]);
  });

  it("reads an empty library root as a root-relative projects folder", async () => {
    const fs = new MemoryLibraryFs();
    await fs.writeText("projects/a/labshelf.yaml", "id: a\nformat: latex\n");
    const entries = await listProjects({ fs, paths: posixPathOps, logger: fakeLogger() }, "", []);
    expect(entries.map((entry) => entry.folder)).toEqual(["projects/a"]);
  });

  it("returns a registered folder that is gone as broken", async () => {
    const { ctx } = await libraryWithProjects();
    const entries = await listProjects(ctx, "/lib", ["/gone"]);
    expect(entries.at(-1)).toMatchObject({ kind: "broken", folder: "/gone", location: "external" });
  });
});

describe("findLibraryProjectFolder", () => {
  it("finds the folder whose labshelf.yaml has the id", async () => {
    const { ctx } = await libraryWithProjects();
    expect(await findLibraryProjectFolder(ctx, "/lib", "notes")).toBe("/lib/projects/notes");
  });

  it("is undefined for an unknown id, an unparseable yaml or a hidden folder", async () => {
    const { fs, ctx } = await libraryWithProjects();
    await fs.writeText("/lib/projects/bad/labshelf.yaml", "format: nonsense\n");
    expect(await findLibraryProjectFolder(ctx, "/lib", "nope")).toBeUndefined();
    expect(await findLibraryProjectFolder(ctx, "/lib", "hidden")).toBeUndefined();
  });
});
