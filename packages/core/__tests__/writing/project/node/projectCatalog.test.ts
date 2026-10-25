/** Verifies listing the writing projects of a library on disk: library projects first, then registered folders. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { listProjectsOnDisk, nodeProjectCatalogContext } from "../../../../src/writing/project/node/index";
import { addExistingFolder, createProjectFromTemplate } from "../../../../src/writing/project/index";
import { createBlankTemplate } from "../../../../src/templates/index";
import type { ProjectFormat } from "../../../../src/writing/project/index";
import type { ILogger } from "../../../../src/ports/index";
import { fakeLogger } from "../../../support/fakeLogger";
import { cleanupTempDirs, makeTempDir } from "../../../support/tempDirs";

afterEach(cleanupTempDirs);

function createBlankProject(lib: string, request: { title: string; format: ProjectFormat }, logger: ILogger) {
  return createProjectFromTemplate(nodeProjectCatalogContext(logger), lib, { title: request.title, ...createBlankTemplate(request.format, request.title) });
}

function addFolder(lib: string, folder: string, format: ProjectFormat, logger: ILogger) {
  return addExistingFolder(nodeProjectCatalogContext(logger), lib, { folder, format });
}

async function setup(): Promise<{ lib: string; outside: string }> {
  const base = await makeTempDir();
  const lib = path.join(base, "lib");
  const outside = path.join(base, "outside");
  await fs.mkdir(lib);
  await fs.mkdir(outside);
  return { lib, outside };
}

async function externalFolder(outside: string, name: string): Promise<string> {
  const dir = path.join(outside, name);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

describe("listProjectsOnDisk", () => {
  it("lists library projects first, then registered ones", async () => {
    const { lib, outside } = await setup();
    const folder = await externalFolder(outside, "ext");
    const logger = fakeLogger();
    await addFolder(lib, folder, "typst", logger);
    await createBlankProject(lib, { title: "Inside", format: "latex" }, logger);
    const list = await listProjectsOnDisk(lib, logger);
    expect(list.map((e) => e.location)).toEqual(["library", "external"]);
  });

  it("lists only registered projects when projects/ is missing", async () => {
    const { lib, outside } = await setup();
    const folder = await externalFolder(outside, "ext");
    const logger = fakeLogger();
    await addFolder(lib, folder, "typst", logger);
    expect((await listProjectsOnDisk(lib, logger)).map((e) => e.folder)).toEqual([folder]);
  });

  it("returns nothing for an empty library and skips hidden folders and files", async () => {
    const { lib } = await setup();
    expect(await listProjectsOnDisk(lib, fakeLogger())).toEqual([]);
    await fs.mkdir(path.join(lib, "projects", ".hidden"), { recursive: true });
    await fs.writeFile(path.join(lib, "projects", "stray.txt"), "x");
    expect(await listProjectsOnDisk(lib, fakeLogger())).toEqual([]);
  });

  it("reports a registered folder that disappeared as broken", async () => {
    const { lib, outside } = await setup();
    const folder = await externalFolder(outside, "ext");
    await addFolder(lib, folder, "typst", fakeLogger());
    await fs.rm(folder, { recursive: true });
    const list = await listProjectsOnDisk(lib, fakeLogger());
    expect(list[0]).toMatchObject({ kind: "broken", reason: "folder not found" });
  });
});
