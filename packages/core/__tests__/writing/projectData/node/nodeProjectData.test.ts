/** Verifies the Node project data port reads and writes project folders through the core functions. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { nodeProjectData } from "../../../../src/writing/projectData/node/index";
import { fakeLogger } from "../../../support/fakeLogger";
import { cleanupTempDirs, makeTempDir } from "../../../support/tempDirs";

afterEach(cleanupTempDirs);

async function library(): Promise<string> {
  const lib = path.join(await makeTempDir(), "lib");
  await fs.mkdir(lib);
  return lib;
}

describe("nodeProjectData", () => {
  it("lists a project created through the port", async () => {
    const data = nodeProjectData(fakeLogger());
    const lib = await library();
    const created = await data.createProject(lib, { title: "Deep Nets", format: "latex" });
    const listed = await data.listProjects(lib);
    expect(listed).toEqual([created]);
    expect(created).toMatchObject({ kind: "ready", location: "library", main: "main.tex" });
  });

  it("shows a settings change in the next listing", async () => {
    const data = nodeProjectData(fakeLogger());
    const lib = await library();
    const created = await data.createProject(lib, { title: "Notes", format: "latex" });
    await data.updateProjectSettings(created.folder, { bibliography: "refs.bib" });
    const [entry] = await data.listProjects(lib);
    expect(entry?.kind === "ready" && entry.settings.bibliography).toBe("refs.bib");
  });

  it("reads value leaves from the files listed in the project settings", async () => {
    const data = nodeProjectData(fakeLogger());
    const lib = await library();
    const created = await data.createProject(lib, { title: "Results", format: "latex" });
    await fs.writeFile(path.join(created.folder, "results.json"), '{"acc":0.9}');
    if (created.kind !== "ready") { throw new Error("project not ready"); }
    // `values` is a user key, which settings patches never write, so the test lists the file directly.
    const settings = { ...created.settings, values: ["results.json"] };
    const leaves = await data.readProjectValues({ folder: created.folder, settings });
    expect(leaves.map((leaf) => [leaf.key, leaf.value])).toEqual([["results.acc", 0.9]]);
  });

  it("puts the build folder of a project under a folder named by its id", () => {
    const data = nodeProjectData(fakeLogger());
    expect(path.basename(data.projectBuildDir("my-paper"))).toBe("my-paper");
  });
});
