// Tests for `labshelf projects`: the JSON shape, the empty listing and the exit code when the library cannot be read.
import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { Output } from "../../src/cli";
import { runProjects } from "../../../src/cli/projects";
import { LibraryRoot } from "../../src/library";
import { cleanupTempDirs, makeTempDir } from "../fixtures/library";

afterEach(cleanupTempDirs);

async function setup() {
  const library = await makeTempDir("labshelf-projects-lib-");
  const out: string[] = [];
  const err: string[] = [];
  const logged: string[] = [];
  const logger = { log: async () => undefined, error: async (module: string) => { logged.push(module); } };
  const io: Output = { out: (t) => out.push(t), err: (t) => err.push(t), columns: 100 };
  const ctx = { logger, paths: new LibraryRoot(library) };
  const addProject = async (folder: string, yaml: string) => {
    await fs.mkdir(path.join(library, "projects", folder), { recursive: true });
    await fs.writeFile(path.join(library, "projects", folder, "labshelf.yaml"), yaml);
  };
  return { library, ctx, io, out, err, logged, addProject };
}

describe("labshelf projects", () => {
  it("prints a JSON array with one object per project", async () => {
    const s = await setup();
    await s.addProject("thesis", "id: thesis\nformat: latex\nmain: main.tex\ntitle: My Thesis\n");
    await s.addProject("notes", "id: notes\nformat: typst\n");
    await s.addProject("bad", "id: bad\nformat: docx\n");

    expect(await runProjects(s.ctx, [], { json: true }, s.io)).toBe(0);

    const parsed = JSON.parse(s.out.join("\n")) as Array<Record<string, unknown>>;
    const byFolder = (name: string) => parsed.find((p) => String(p["folder"]).endsWith(`${path.sep}${name}`));
    expect(parsed).toHaveLength(3);
    expect(byFolder("thesis")).toEqual({
      kind: "ready", id: "thesis", name: "My Thesis", format: "latex", main: "main.tex",
      folder: path.join(s.library, "projects", "thesis"), location: "library",
    });
    expect(byFolder("notes")).toMatchObject({ kind: "ready", id: "notes", name: "notes", format: "typst", main: null });
    expect(byFolder("bad")).toMatchObject({ kind: "broken", location: "library", reason: expect.stringMatching(/format must be one of/) });
  });

  it("prints an empty JSON array and 'No projects' for an empty library", async () => {
    const s = await setup();
    expect(await runProjects(s.ctx, [], { json: true }, s.io)).toBe(0);
    expect(JSON.parse(s.out[0] ?? "")).toEqual([]);
    s.out.length = 0;
    expect(await runProjects(s.ctx, [], {}, s.io)).toBe(0);
    expect(s.out).toEqual(["No projects"]);
  });

  it("exits 1 with the context on the error stream and in the log when the library cannot be read", async () => {
    const s = await setup();
    await fs.writeFile(path.join(s.library, "projects"), "not a folder");

    expect(await runProjects(s.ctx, [], { json: true }, s.io)).toBe(1);

    expect(s.out).toEqual([]);
    expect(s.err.join("\n")).toMatch(/Could not list projects in .*labshelf-projects-lib-/);
    expect(s.logged).toEqual(["terminal.projects"]);
  });
});
