/** Verifies creating, adding and listing writing projects of a library. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import {
  addExistingFolder, createProjectFromTemplate, listProjects, loadProjectRegistry,
} from "../../../../src/writing/project/node/index";
import type { ProjectFormat } from "../../../../src/writing/project/index";
import { blankTemplate } from "../../../../src/writing/templates/index";
import type { ILogger } from "../../../../src/ports/index";
import { fakeLogger } from "../../../support/fakeLogger";
import { cleanupTempDirs, listFiles, makeTempDir } from "../../../support/tempDirs";

afterEach(cleanupTempDirs);

function createBlankProject(lib: string, request: { title: string; format: ProjectFormat }, logger: ILogger) {
  return createProjectFromTemplate(lib, { title: request.title, ...blankTemplate(request.format, request.title) }, logger);
}

async function setup(): Promise<{ lib: string; outside: string }> {
  const base = await makeTempDir();
  const lib = path.join(base, "lib");
  const outside = path.join(base, "outside");
  await fs.mkdir(lib);
  await fs.mkdir(outside);
  return { lib, outside };
}

async function externalFolder(outside: string, name: string, files: Record<string, string> = {}): Promise<string> {
  const dir = path.join(outside, name);
  await fs.mkdir(dir, { recursive: true });
  for (const [file, text] of Object.entries(files)) { await fs.writeFile(path.join(dir, file), text); }
  return dir;
}

describe("createProjectFromTemplate", () => {
  it("creates projects/<id>/ with labshelf.yaml and the template main", async () => {
    const { lib } = await setup();
    const entry = await createBlankProject(lib, { title: "Deep Nets: a Survey", format: "latex" }, fakeLogger());
    const folder = path.join(lib, "projects", "deep-nets-a-survey");
    expect(entry).toMatchObject({ kind: "ready", folder, location: "library", main: "main.tex" });
    expect(await fs.readFile(path.join(folder, "labshelf.yaml"), "utf8")).toBe("id: deep-nets-a-survey\nformat: latex\nmain: main.tex\n");
    expect(await fs.readFile(path.join(folder, "main.tex"), "utf8")).toContain("\\title{Deep Nets: a Survey}");
    expect(await listFiles(folder)).toEqual(["labshelf.yaml", "main.tex"]);
  });

  it("creates a Typst project with main.typ", async () => {
    const { lib } = await setup();
    const entry = await createBlankProject(lib, { title: "Notes", format: "typst" }, fakeLogger());
    expect(entry.kind === "ready" && entry.main).toBe("main.typ");
  });

  it("gives a second project with the same title the suffix a", async () => {
    const { lib } = await setup();
    await createBlankProject(lib, { title: "Thesis", format: "latex" }, fakeLogger());
    const second = await createBlankProject(lib, { title: "Thesis", format: "latex" }, fakeLogger());
    expect(second.kind === "ready" && second.settings.id).toBe("thesisa");
    expect(path.basename(second.folder)).toBe("thesisa");
  });
});

describe("addExistingFolder", () => {
  it("writes labshelf.yaml only, registers the folder and lists it as external", async () => {
    const { lib, outside } = await setup();
    const folder = await externalFolder(outside, "My Paper", { "main.tex": "\\documentclass{article}" });
    await fs.mkdir(path.join(folder, ".git"));
    await fs.writeFile(path.join(folder, ".git", "HEAD"), "ref");
    const before = await listFiles(folder);

    const logger = fakeLogger();
    const entry = await addExistingFolder(lib, { folder, format: "latex" }, logger);

    expect(entry).toMatchObject({ kind: "ready", folder, location: "external", main: "main.tex", settings: { id: "my-paper" } });
    expect(await listFiles(folder)).toEqual([...before, "labshelf.yaml"].sort());
    expect(await fs.readFile(path.join(folder, "main.tex"), "utf8")).toBe("\\documentclass{article}");
    expect((await loadProjectRegistry(lib, logger)).folders).toEqual([folder]);
    expect((await listProjects(lib, logger)).map((e) => [e.folder, e.location])).toEqual([[folder, "external"]]);
  });

  it("leaves an existing valid labshelf.yaml byte-identical", async () => {
    const { lib, outside } = await setup();
    const text = "# keep\nid: mine\nformat: typst\nextra: 1\n";
    const folder = await externalFolder(outside, "p", { "labshelf.yaml": text });
    await addExistingFolder(lib, { folder, format: "latex" }, fakeLogger());
    expect(await fs.readFile(path.join(folder, "labshelf.yaml"), "utf8")).toBe(text);
  });

  it("rejects an invalid existing labshelf.yaml without registering", async () => {
    const { lib, outside } = await setup();
    const folder = await externalFolder(outside, "p", { "labshelf.yaml": "id: a\nformat: nope\n" });
    const logger = fakeLogger();
    await expect(addExistingFolder(lib, { folder, format: "latex" }, logger)).rejects.toThrow(/format must be/);
    expect((await loadProjectRegistry(lib, logger)).folders).toEqual([]);
  });

  it("rejects a folder inside the library root", async () => {
    const { lib } = await setup();
    const inside = path.join(lib, "projects", "x");
    await fs.mkdir(inside, { recursive: true });
    const logger = fakeLogger();
    await expect(addExistingFolder(lib, { folder: inside, format: "latex" }, logger)).rejects.toThrow(/inside the library/);
    expect((await loadProjectRegistry(lib, logger)).folders).toEqual([]);
  });

  it("rejects an existing id that clashes with another project", async () => {
    const { lib, outside } = await setup();
    await createBlankProject(lib, { title: "Thesis", format: "latex" }, fakeLogger());
    const folder = await externalFolder(outside, "p", { "labshelf.yaml": "id: Thesis\nformat: latex\n" });
    const logger = fakeLogger();
    await expect(addExistingFolder(lib, { folder, format: "latex" }, logger)).rejects.toThrow(/already used/);
    expect((await loadProjectRegistry(lib, logger)).folders).toEqual([]);
  });

  it("gives a folder without labshelf.yaml a fresh id when its name clashes", async () => {
    const { lib, outside } = await setup();
    await createBlankProject(lib, { title: "paper", format: "latex" }, fakeLogger());
    const folder = await externalFolder(outside, "paper");
    const entry = await addExistingFolder(lib, { folder, format: "latex" }, fakeLogger());
    expect(entry.kind === "ready" && entry.settings.id).toBe("papera");
  });
});

describe("listProjects", () => {
  it("lists library projects first, then registered ones", async () => {
    const { lib, outside } = await setup();
    const folder = await externalFolder(outside, "ext");
    const logger = fakeLogger();
    await addExistingFolder(lib, { folder, format: "typst" }, logger);
    await createBlankProject(lib, { title: "Inside", format: "latex" }, logger);
    const list = await listProjects(lib, logger);
    expect(list.map((e) => e.location)).toEqual(["library", "external"]);
  });

  it("lists only registered projects when projects/ is missing", async () => {
    const { lib, outside } = await setup();
    const folder = await externalFolder(outside, "ext");
    const logger = fakeLogger();
    await addExistingFolder(lib, { folder, format: "typst" }, logger);
    expect((await listProjects(lib, logger)).map((e) => e.folder)).toEqual([folder]);
  });

  it("returns nothing for an empty library and skips hidden folders and files", async () => {
    const { lib } = await setup();
    expect(await listProjects(lib, fakeLogger())).toEqual([]);
    await fs.mkdir(path.join(lib, "projects", ".hidden"), { recursive: true });
    await fs.writeFile(path.join(lib, "projects", "stray.txt"), "x");
    expect(await listProjects(lib, fakeLogger())).toEqual([]);
  });

  it("reports a registered folder that disappeared as broken", async () => {
    const { lib, outside } = await setup();
    const folder = await externalFolder(outside, "ext");
    await addExistingFolder(lib, { folder, format: "typst" }, fakeLogger());
    await fs.rm(folder, { recursive: true });
    const list = await listProjects(lib, fakeLogger());
    expect(list[0]).toMatchObject({ kind: "broken", reason: "folder not found" });
  });
});
