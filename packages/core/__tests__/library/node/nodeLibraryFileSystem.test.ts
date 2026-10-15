import { promises as fs } from "node:fs";
import * as path from "node:path";

import { NodeLibraryFileSystem } from "../../../src/library/node/index";
import { cleanupTempDirs, listFiles, makeTempDir, pathExists } from "../../support/tempDirs";

afterEach(cleanupTempDirs);

async function setup(trash = jest.fn(async (target: string) => fs.rm(target, { recursive: true }))) {
  const dir = await makeTempDir();
  const tmp = path.join(dir, ".research", "tmp");
  return { dir, tmp, trash, lfs: new NodeLibraryFileSystem(tmp, trash) };
}

describe("NodeLibraryFileSystem: reads and writes", () => {
  it("reads and writes text and bytes atomically, creating parents, without leftovers", async () => {
    const { dir, tmp, lfs } = await setup();
    await lfs.writeText(path.join(dir, "a", "m.yaml"), "title: A\n");
    await lfs.writeFile(path.join(dir, "a", "deep", "paper.pdf"), new Uint8Array([1, 2, 3]));
    expect(await lfs.readText(path.join(dir, "a", "m.yaml"))).toBe("title: A\n");
    const bytes = await lfs.readFile(path.join(dir, "a", "deep", "paper.pdf"));
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect([...bytes]).toEqual([1, 2, 3]);
    expect(await listFiles(dir)).toEqual(["a/deep/paper.pdf", "a/m.yaml"]);
    expect(await listFiles(tmp)).toEqual([]);
  });

  it("writes beside the target when no temp folder is given", async () => {
    const dir = await makeTempDir();
    await new NodeLibraryFileSystem().writeText(path.join(dir, "f.txt"), "x");
    expect(await listFiles(dir)).toEqual(["f.txt"]);
  });

  it("readText rejects for a missing file", async () => {
    const { dir, lfs } = await setup();
    await expect(lfs.readText(path.join(dir, "missing"))).rejects.toThrow(/ENOENT/);
  });

  it("deletes a file, and does not fail for one that is already gone", async () => {
    const { dir, lfs } = await setup();
    const file = path.join(dir, "f.txt");
    await fs.writeFile(file, "x");
    await lfs.deleteFile(file);
    expect(await pathExists(file)).toBe(false);
    await expect(lfs.deleteFile(file)).resolves.toBeUndefined();
  });
});

describe("NodeLibraryFileSystem: folders and stat", () => {
  it("ensureDir and mkdir are recursive and idempotent", async () => {
    const { dir, lfs } = await setup();
    await lfs.ensureDir(path.join(dir, "a", "b"));
    await lfs.ensureDir(path.join(dir, "a", "b"));
    await lfs.mkdir(path.join(dir, "ML", "Vision"));
    await lfs.mkdir(path.join(dir, "ML", "Vision"));
    expect((await fs.stat(path.join(dir, "a", "b"))).isDirectory()).toBe(true);
    expect((await lfs.stat(path.join(dir, "ML", "Vision")))?.isDirectory).toBe(true);
  });

  it("exists is true for files and folders and false otherwise", async () => {
    const { dir, lfs } = await setup();
    await fs.writeFile(path.join(dir, "f.txt"), "x");
    expect(await lfs.exists(path.join(dir, "f.txt"))).toBe(true);
    expect(await lfs.exists(dir)).toBe(true);
    expect(await lfs.exists(path.join(dir, "missing"))).toBe(false);
  });

  it("stats files and folders, and returns undefined for a missing path", async () => {
    const { dir, lfs } = await setup();
    const file = path.join(dir, "f.txt");
    await fs.writeFile(file, "12345");
    const fileStat = await lfs.stat(file);
    expect(fileStat).toMatchObject({ isFile: true, isDirectory: false, size: 5 });
    expect(fileStat!.mtimeMs).toBeGreaterThan(0);
    expect(await lfs.stat(dir)).toMatchObject({ isFile: false, isDirectory: true });
    expect(await lfs.stat(path.join(dir, "missing"))).toBeUndefined();
  });

  it("stats a symlink as neither file nor folder, like VS Code's adapter", async () => {
    const { dir, lfs } = await setup();
    await fs.writeFile(path.join(dir, "real.pdf"), "x");
    await fs.symlink(path.join(dir, "real.pdf"), path.join(dir, "link.pdf"));
    expect(await lfs.stat(path.join(dir, "link.pdf"))).toMatchObject({ isFile: false, isDirectory: false });
  });
});

describe("NodeLibraryFileSystem: listDir", () => {
  it("lists a folder, and returns [] for one that does not exist", async () => {
    const { dir, lfs } = await setup();
    await fs.writeFile(path.join(dir, "a.txt"), "a");
    await fs.mkdir(path.join(dir, "sub"));
    expect((await lfs.listDir(dir)).sort()).toEqual(["a.txt", "sub"]);
    expect(await lfs.listDir(path.join(dir, "missing"))).toEqual([]);
  });

  it("throws for a folder it may not read or a path that is a file, unlike a missing one", async () => {
    const { dir, lfs } = await setup();
    const locked = path.join(dir, "locked");
    await fs.mkdir(locked);
    await fs.chmod(locked, 0o000);
    try {
      await expect(lfs.listDir(locked)).rejects.toMatchObject({ code: "EACCES" });
    } finally {
      await fs.chmod(locked, 0o755);
    }
    await fs.writeFile(path.join(dir, "file"), "x");
    await expect(lfs.listDir(path.join(dir, "file"))).rejects.toThrow();
  });

  it("lists every name, like VS Code's adapter (both apps must see one tree through the shared manifest)", async () => {
    const { dir, lfs } = await setup();
    await fs.writeFile(path.join(dir, "paper.pdf"), "x");
    await fs.writeFile(path.join(dir, ".paper.pdf.1234-abcd.tmp"), "half");
    await fs.writeFile(path.join(dir, ".hidden"), "dotfile");
    expect((await lfs.listDir(dir)).sort()).toEqual([".hidden", ".paper.pdf.1234-abcd.tmp", "paper.pdf"]);
  });
});

describe("NodeLibraryFileSystem: rename and trash", () => {
  it("renames a folder with its contents", async () => {
    const { dir, lfs } = await setup();
    await lfs.mkdir(path.join(dir, "ML", "Vision"));
    await lfs.rename(path.join(dir, "ML"), path.join(dir, "Bio"));
    expect(await lfs.exists(path.join(dir, "Bio", "Vision"))).toBe(true);
    expect(await lfs.exists(path.join(dir, "ML"))).toBe(false);
  });

  it("refuses to rename onto an existing file and leaves both files intact", async () => {
    const { dir, lfs } = await setup();
    await fs.writeFile(path.join(dir, "a.txt"), "a");
    await fs.writeFile(path.join(dir, "b.txt"), "b");
    await expect(lfs.rename(path.join(dir, "a.txt"), path.join(dir, "b.txt"))).rejects.toMatchObject({ code: "EEXIST" });
    expect(await fs.readFile(path.join(dir, "a.txt"), "utf8")).toBe("a");
    expect(await fs.readFile(path.join(dir, "b.txt"), "utf8")).toBe("b");
  });

  it("refuses to rename a folder onto an existing empty folder", async () => {
    const { dir, lfs } = await setup();
    await lfs.mkdir(path.join(dir, "ML", "Vision"));
    await lfs.mkdir(path.join(dir, "Bio"));
    await expect(lfs.rename(path.join(dir, "ML"), path.join(dir, "Bio"))).rejects.toMatchObject({ code: "EEXIST" });
    expect(await lfs.exists(path.join(dir, "ML", "Vision"))).toBe(true);
  });

  it("renames a folder when only its letter case changes", async () => {
    const { dir, lfs } = await setup();
    await lfs.mkdir(path.join(dir, "ml"));
    await lfs.rename(path.join(dir, "ml"), path.join(dir, "ML"));
    expect(await fs.readdir(dir)).toContain("ML");
    expect(await fs.readdir(dir)).not.toContain("ml");
  });

  it("hands trash to the injected platform trash and passes its failure on", async () => {
    const { dir, lfs, trash } = await setup();
    await lfs.mkdir(path.join(dir, "ML"));
    await lfs.trash(path.join(dir, "ML"));
    expect(trash).toHaveBeenCalledWith(path.join(dir, "ML"));
    expect(await pathExists(path.join(dir, "ML"))).toBe(false);

    const failing = new NodeLibraryFileSystem(undefined, async () => { throw new Error("no trash here"); });
    await expect(failing.trash(dir)).rejects.toThrow("no trash here");
  });

  it("refuses to trash without a platform trash and leaves the target", async () => {
    const { dir } = await setup();
    await expect(new NodeLibraryFileSystem().trash(dir)).rejects.toThrow(/no trash/);
    expect(await pathExists(dir)).toBe(true);
  });
});
