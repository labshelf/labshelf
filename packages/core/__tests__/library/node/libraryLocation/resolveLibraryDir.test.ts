import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { resolveLibraryDir } from "../../../../src/library/node/location";

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

  describe("a folder that cannot be listed", () => {
    let locked: string;
    beforeEach(() => { locked = path.join(dir, "locked"); fs.mkdirSync(locked); fs.chmodSync(locked, 0o000); });
    afterEach(() => { fs.chmodSync(locked, 0o700); });
    const skip = process.platform === "win32" || process.getuid?.() === 0;

    (skip ? it.skip : it)("rejects by default", async () => {
      await expect(resolveLibraryDir(locked)).rejects.toThrow();
    });

    (skip ? it.skip : it)("is treated as empty when asked to", async () => {
      expect(await resolveLibraryDir(locked, { unreadableAsEmpty: true })).toBe(locked);
    });
  });
});
