/** Verifies listing the library's projects with registered folders and finding a library project folder by id. */
import { posixPathOps } from "../../../../src/library/index";
import { findLibraryProjectFolder, listProjects } from "../../../../src/writing/project/folder/index";
import { fakeLogger } from "../../../support/fakeLogger";
import { MemoryLibraryFs } from "../../../support/memoryLibraryFs";

async function setup() {
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
    const { ctx } = await setup();
    const entries = await listProjects(ctx, "/lib", ["/outside/paper"]);
    expect(entries.map((entry) => [entry.folder, entry.location, entry.kind]).sort()).toEqual([
      ["/lib/projects/notes", "library", "ready"], ["/lib/projects/thesis", "library", "ready"], ["/outside/paper", "external", "ready"],
    ]);
    expect(entries.at(-1)?.location).toBe("external");
  });

  it("lists nothing when the projects folder is missing", async () => {
    const { ctx } = await setup();
    expect(await listProjects(ctx, "/empty", [])).toEqual([]);
  });

  it("reads an empty library root as a root-relative projects folder", async () => {
    const fs = new MemoryLibraryFs();
    await fs.writeText("projects/a/labshelf.yaml", "id: a\nformat: latex\n");
    const entries = await listProjects({ fs, paths: posixPathOps, logger: fakeLogger() }, "", []);
    expect(entries.map((entry) => entry.folder)).toEqual(["projects/a"]);
  });

  it("returns a registered folder that is gone as broken", async () => {
    const { ctx } = await setup();
    const entries = await listProjects(ctx, "/lib", ["/gone"]);
    expect(entries.at(-1)).toMatchObject({ kind: "broken", folder: "/gone", location: "external" });
  });
});

describe("findLibraryProjectFolder", () => {
  it("finds the folder whose labshelf.yaml has the id", async () => {
    const { ctx } = await setup();
    expect(await findLibraryProjectFolder(ctx, "/lib", "notes")).toBe("/lib/projects/notes");
  });

  it("is undefined for an unknown id, an unparseable yaml or a hidden folder", async () => {
    const { fs, ctx } = await setup();
    await fs.writeText("/lib/projects/bad/labshelf.yaml", "format: nonsense\n");
    expect(await findLibraryProjectFolder(ctx, "/lib", "nope")).toBeUndefined();
    expect(await findLibraryProjectFolder(ctx, "/lib", "hidden")).toBeUndefined();
  });
});
