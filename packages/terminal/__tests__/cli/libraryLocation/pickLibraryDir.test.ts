import { promises as fs } from "node:fs";
import * as path from "node:path";

import { resolveLibraryDir } from "../../../src/cli/libraryLocation/pickLibraryDir";
import { makeTempDir } from "../../fixtures/library";

describe("resolveLibraryDir", () => {
  let dir: string;
  beforeEach(async () => { dir = await makeTempDir(); });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it("uses a missing or empty folder as it is", async () => {
    expect(await resolveLibraryDir(path.join(dir, "new"))).toBe(path.join(dir, "new"));
    await fs.mkdir(path.join(dir, "empty"));
    expect(await resolveLibraryDir(path.join(dir, "empty"))).toBe(path.join(dir, "empty"));
  });

  it("puts the library in a LabShelf subfolder of a non-empty folder that is not a library", async () => {
    await fs.writeFile(path.join(dir, "notes.txt"), "x");
    expect(await resolveLibraryDir(dir)).toBe(path.join(dir, "LabShelf"));
  });

  it("keeps an existing library folder as the target, so the move refuses it", async () => {
    await fs.mkdir(path.join(dir, "papers"));
    await fs.mkdir(path.join(dir, ".research"));
    expect(await resolveLibraryDir(dir)).toBe(dir);
  });
});
