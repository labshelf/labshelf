import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { resolveLibraryDir } from "../../../../src/library/node/libraryLocation/resolveLibraryDir";

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "labshelf-target-")); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe("resolveLibraryDir", () => {
  it("uses an empty folder as it is", async () => {
    expect(await resolveLibraryDir(dir)).toBe(dir);
  });

  it("uses a folder that does not exist yet as it is", async () => {
    const missing = path.join(dir, "new");
    expect(await resolveLibraryDir(missing)).toBe(missing);
  });

  it("creates the library in a LabShelf subfolder when the folder holds other files", async () => {
    fs.writeFileSync(path.join(dir, "notes.txt"), "x");
    expect(await resolveLibraryDir(dir)).toBe(path.join(dir, "LabShelf"));
  });

  it("opens a folder that is already a library", async () => {
    fs.mkdirSync(path.join(dir, ".research"));
    fs.mkdirSync(path.join(dir, "papers"));
    fs.writeFileSync(path.join(dir, "other.txt"), "x");
    expect(await resolveLibraryDir(dir)).toBe(dir);
  });
});
