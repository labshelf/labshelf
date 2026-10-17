// Tests for choosing the project `labshelf build` builds: the argument, else the project containing the working directory.
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { UsageError } from "../../../src/cli";
import { findProject } from "../../../src/cli/build";
import { cleanupTempDirs, makeTempDir } from "../../fixtures/library";

afterEach(cleanupTempDirs);

const logger = { log: async () => undefined, error: async () => undefined };

async function project() {
  const library = await makeTempDir("labshelf-find-lib-");
  const folder = await makeTempDir("labshelf-find-project-");
  await fs.writeFile(path.join(folder, "labshelf.yaml"), "id: thesis\nformat: latex\nmain: main.tex\n");
  await fs.mkdir(path.join(folder, "chapters"));
  return { library, folder };
}

describe("findProject", () => {
  it("reads the folder named by the argument", async () => {
    const { library, folder } = await project();
    expect(await findProject(library, logger, folder, "/")).toMatchObject({ kind: "ready", folder, main: "main.tex" });
  });

  it("walks up from a subfolder of the working directory", async () => {
    const { library, folder } = await project();
    expect(await findProject(library, logger, undefined, path.join(folder, "chapters"))).toMatchObject({ folder });
  });

  it("names the working directory when no project contains it", async () => {
    const { library } = await project();
    const elsewhere = await makeTempDir("labshelf-find-none-");
    await expect(findProject(library, logger, undefined, elsewhere)).rejects.toThrow(UsageError);
  });
});
