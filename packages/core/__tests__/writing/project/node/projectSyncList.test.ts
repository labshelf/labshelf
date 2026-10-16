/** Verifies the project list the sync engine receives: ready projects only, with their ignore patterns. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { listSyncProjects } from "../../../../src/writing/project/node/index";
import { fakeLogger } from "../../../support/fakeLogger";
import { cleanupTempDirs, makeTempDir } from "../../../support/tempDirs";

afterEach(cleanupTempDirs);

async function write(file: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text);
}

describe("listSyncProjects", () => {
  it("lists library and registered projects with their ignore patterns, and leaves out the unreadable ones", async () => {
    const base = await makeTempDir();
    const library = path.join(base, "lib");
    const external = path.join(base, "elsewhere", "thesis");
    await write(path.join(library, "projects", "own", "labshelf.yaml"), "id: own\nformat: latex\nignore: [data/**]\n");
    await write(path.join(library, "projects", "bad", "labshelf.yaml"), "id: bad\nformat: latex\nignore: nope\n");
    await write(path.join(external, "labshelf.yaml"), "id: thesis\nformat: typst\n");
    await write(path.join(library, ".research", "projects.json"), JSON.stringify({ folders: [external, path.join(base, "gone")] }));

    const projects = await listSyncProjects(library, fakeLogger());

    expect(projects).toEqual([
      { id: "own", root: path.join(library, "projects", "own"), ignore: ["data/**"] },
      { id: "thesis", root: external, ignore: [] },
    ]);
  });
});
