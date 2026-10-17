/** Verifies that deleting a project forever removes library folders only and keeps registered folders on disk. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { addExistingFolder, createProjectFromTemplate, deleteProjectForever, loadProjectRegistry } from "../../../../src/writing/project/node/index";
import { blankTemplate } from "../../../../src/writing/templates/index";
import { fakeLogger } from "../../../support/fakeLogger";
import { cleanupTempDirs, makeTempDir } from "../../../support/tempDirs";

afterEach(cleanupTempDirs);

const exists = (target: string) => fs.stat(target).then(() => true, () => false);

describe("deleteProjectForever", () => {
  it("removes a library project folder", async () => {
    const lib = path.join(await makeTempDir(), "lib");
    await fs.mkdir(lib);
    const logger = fakeLogger();
    const entry = await createProjectFromTemplate(lib, { title: "Notes", ...blankTemplate("latex", "Notes") }, logger);
    await deleteProjectForever(lib, entry.folder, logger);
    expect(await exists(entry.folder)).toBe(false);
    expect(await exists(path.join(lib, "projects"))).toBe(true);
  });

  it("unregisters an external folder and leaves its files", async () => {
    const base = await makeTempDir();
    const lib = path.join(base, "lib");
    const outside = path.join(base, "outside");
    await fs.mkdir(lib);
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, "main.tex"), "hello");
    const logger = fakeLogger();
    await addExistingFolder(lib, { folder: outside, format: "latex" }, logger);
    await deleteProjectForever(lib, outside, logger);
    expect(await fs.readFile(path.join(outside, "main.tex"), "utf8")).toBe("hello");
    expect((await loadProjectRegistry(lib, logger)).folders).toEqual([]);
  });

  it("refuses the projects folder itself", async () => {
    const lib = path.join(await makeTempDir(), "lib");
    const projects = path.join(lib, "projects");
    await fs.mkdir(projects, { recursive: true });
    await expect(deleteProjectForever(lib, projects, fakeLogger())).rejects.toThrow(/projects folder/);
    expect(await exists(projects)).toBe(true);
  });
});
