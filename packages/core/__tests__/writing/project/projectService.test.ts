/** Verifies the project data port runs over an injected file system and keeps device files under the injected folders, and the Files tree rows: hidden entries, folders-first order and the main and source marks. */
import * as path from "node:path";

import { createProjectContent, createProjectFileRow, listVisibleEntries, type ProjectDeviceDirs } from "../../../src/writing/project/projectService";
import { createBlankTemplate } from "../../../src/templates/index";
import { fakeLogger } from "../../support/fakeLogger";
import { MemoryLibraryFs } from "../../support/memoryLibraryFs";

const blank = (title: string) => ({ title, ...createBlankTemplate("latex", title) });
const dirs = {
  projectRegistryPath: "/device/state/projects.json", buildCacheDir: "/device/cache/builds", mergeBasesDir: "/device/state/merge-bases",
};

async function setup(deviceDirs: ProjectDeviceDirs = dirs) {
  const fs = new MemoryLibraryFs();
  await fs.mkdir("/lib");
  return { fs, data: createProjectContent({ fs, path: path.posix, logger: fakeLogger(), deviceDirs }) };
}

describe("createProjectContent", () => {
  it("lists a project created through the port", async () => {
    const { data } = await setup();
    const created = await data.createProjectFromTemplate("/lib", blank("Deep Nets"));
    expect(await data.listProjects("/lib")).toEqual([created]);
    expect(created).toMatchObject({ kind: "ready", location: "library", main: "main.tex" });
  });

  it("shows a settings change in the next listing", async () => {
    const { data } = await setup();
    const created = await data.createProjectFromTemplate("/lib", blank("Notes"));
    await data.updateProjectSettings(created.folder, { bibliography: "refs.bib" });
    const [entry] = await data.listProjects("/lib");
    expect(entry?.kind === "ready" && entry.settings.bibliography).toBe("refs.bib");
  });

  it("reads value leaves from the files listed in the project settings", async () => {
    const { fs, data } = await setup();
    const created = await data.createProjectFromTemplate("/lib", blank("Results"));
    await fs.writeText(path.posix.join(created.folder, "results.json"), '{"acc":0.9}');
    if (created.kind !== "ready") { throw new Error("project not ready"); }
    // `values` is a user key, which settings patches never write, so the test lists the file directly.
    const settings = { ...created.settings, values: ["results.json"] };
    const leaves = await data.readProjectValues({ folder: created.folder, settings });
    expect(leaves.map((leaf) => [leaf.key, leaf.value])).toEqual([["results.acc", 0.9]]);
  });

  it("keeps the registry of external folders at the injected registry path", async () => {
    const { fs, data } = await setup();
    await fs.mkdir("/code/paper");
    await data.addExistingFolder("/lib", { folder: "/code/paper", format: "latex" });
    expect(JSON.parse(await fs.readText(dirs.projectRegistryPath))).toEqual({ folders: ["/code/paper"] });
    expect((await data.listProjects("/lib")).map((entry) => entry.folder)).toContain("/code/paper");

    await data.unregisterProjectFolder("/lib", "/code/paper");
    expect(JSON.parse(await fs.readText(dirs.projectRegistryPath))).toEqual({ folders: [] });
  });

  it("puts a project's build folder under the injected build cache, named by its id", async () => {
    const { data } = await setup();
    expect(data.projectBuildDir("my-paper")).toBe("/device/cache/builds/my-paper");
  });

  it("reads the device folders at call time, so a library switch moves them", async () => {
    let cache = "/one/builds";
    const { data } = await setup({ ...dirs, get buildCacheDir() { return cache; } });
    cache = "/two/builds";
    expect(data.projectBuildDir("p")).toBe("/two/builds/p");
  });

  it("keeps no project folder registry when the device has no registry path", async () => {
    const { buildCacheDir, mergeBasesDir } = dirs;
    const { fs, data } = await setup({ buildCacheDir, mergeBasesDir });
    const created = await data.createProjectFromTemplate("/lib", blank("Notes"));
    expect(await data.listProjects("/lib")).toEqual([created]);
    await fs.mkdir("/code/paper");
    await expect(data.addExistingFolder("/lib", { folder: "/code/paper", format: "latex" })).rejects.toThrow(/registry/);
    expect([...fs.files.keys()].some((file) => file.endsWith("projects.json"))).toBe(false);
  });
});

describe("listVisibleEntries", () => {
  it("drops .git and .labshelf and lists folders first, then by name", () => {
    const entries = [
      { name: "refs.bib", folder: false }, { name: ".labshelf", folder: true }, { name: "src", folder: true },
      { name: "Abstract.tex", folder: false }, { name: ".git", folder: true }, { name: "figures", folder: true },
    ];
    expect(listVisibleEntries(entries).map((entry) => entry.name)).toEqual(["figures", "src", "Abstract.tex", "refs.bib"]);
  });
});

describe("createProjectFileRow", () => {
  const context = { format: "latex", main: "./src/main.tex" } as const;

  it("marks the main file and opens files on click", () => {
    const { kind, node } = createProjectFileRow("src/main.tex", false, context);
    expect(kind).toBe("file");
    expect(node).toMatchObject({ key: "src/main.tex", label: "main.tex", description: "main", clickable: true });
  });

  it("offers other sources of the project's format as the main file", () => {
    expect(createProjectFileRow("src/intro.tex", false, context).kind).toBe("source");
    expect(createProjectFileRow("refs.bib", false, context).kind).toBe("file");
    expect(createProjectFileRow("a.typ", false, { format: "typst", main: undefined }).kind).toBe("source");
    expect(createProjectFileRow("a.tex", false, { format: undefined, main: undefined }).kind).toBe("file");
  });

  it("shows a folder as a collapsed node with no description", () => {
    const { kind, node } = createProjectFileRow("src", true, context);
    expect(kind).toBe("folder");
    expect(node).toMatchObject({ label: "src", children: [], open: false });
    expect(node.description).toBeUndefined();
  });
});
