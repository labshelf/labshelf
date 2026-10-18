/** Verifies the project data port runs over an injected file system and keeps device files under the injected folders. */
import * as path from "node:path";

import { createProjectData, type ProjectDeviceDirs } from "../../../src/writing/projectData/index";
import { blankTemplate } from "../../../src/writing/templates/index";
import { fakeLogger } from "../../support/fakeLogger";
import { MemoryLibraryFs } from "../../support/memoryLibraryFs";

const blank = (title: string) => ({ title, ...blankTemplate("latex", title) });
const dirs: ProjectDeviceDirs = {
  projectRegistryPath: "/device/state/projects.json", buildCacheDir: "/device/cache/builds", mergeBasesDir: "/device/state/merge-bases",
};

async function setup(deviceDirs: ProjectDeviceDirs = dirs) {
  const fs = new MemoryLibraryFs();
  await fs.mkdir("/lib");
  return { fs, data: createProjectData({ fs, path: path.posix, logger: fakeLogger(), deviceDirs }) };
}

describe("createProjectData", () => {
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
});
