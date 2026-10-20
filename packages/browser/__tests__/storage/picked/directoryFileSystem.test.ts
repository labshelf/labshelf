// Pins the library file system over a picked folder: nested paths, missing entries, renames and refused access.
import { DirectoryFileSystem } from "../../../src/storage/picked/directoryFileSystem";
import { FakeDir } from "../../support/fakeDirectoryHandle";

function setup(caseInsensitive = false) {
  const root = new FakeDir("Library", caseInsensitive);
  const fs = new DirectoryFileSystem(async () => root as unknown as FileSystemDirectoryHandle);
  return { root, fs };
}

describe("DirectoryFileSystem", () => {
  it("writes into folders it creates and reads the bytes back", async () => {
    const { root, fs } = setup();
    await fs.writeText("papers/ml/smith2020/metadata.yaml", "title: X");
    expect(root.dump()).toEqual(["papers/ml/smith2020/metadata.yaml: title: X"]);
    await expect(fs.readText("papers/ml/smith2020/metadata.yaml")).resolves.toBe("title: X");
    await expect(fs.listDir("papers/ml")).resolves.toEqual(["smith2020"]);
  });

  it("reports missing entries as absent instead of failing", async () => {
    const { fs } = setup();
    await fs.writeText("papers/a.txt", "x");
    await expect(fs.listDir("nowhere")).resolves.toEqual([]);
    await expect(fs.listDir("papers/a.txt/below")).resolves.toEqual([]);
    await expect(fs.stat("papers/missing")).resolves.toBeUndefined();
    await expect(fs.exists("papers/a.txt/below")).resolves.toBe(false);
    await expect(fs.readFile("papers/missing")).rejects.toThrow("File not found: papers/missing");
    await expect(fs.removeTree("papers/missing")).resolves.toBeUndefined();
    await expect(fs.deleteFile("nowhere/a.txt")).resolves.toBeUndefined();
  });

  it("stats files and folders, the root included", async () => {
    const { fs } = setup();
    await fs.writeText("papers/a.txt", "abc");
    await expect(fs.stat("papers/a.txt")).resolves.toMatchObject({ isFile: true, isDirectory: false, size: 3 });
    await expect(fs.stat("papers")).resolves.toMatchObject({ isFile: false, isDirectory: true });
    await expect(fs.stat("")).resolves.toMatchObject({ isDirectory: true });
  });

  it("keeps an empty folder made by mkdir and removes a whole tree", async () => {
    const { root, fs } = setup();
    await fs.mkdir("papers/empty");
    await expect(fs.stat("papers/empty")).resolves.toMatchObject({ isDirectory: true });
    await fs.writeText("papers/full/a/b.txt", "x");
    await fs.removeTree("papers/full");
    expect(root.dump()).toEqual([]);
    await expect(fs.listDir("papers")).resolves.toEqual(["empty"]);
  });

  it("renames a folder with everything below it", async () => {
    const { root, fs } = setup();
    await fs.writeText("papers/a/x/metadata.yaml", "title: X");
    await fs.writeText("papers/a/x/paper.pdf", "PDF");
    await fs.rename("papers/a", "papers/b");
    expect(root.dump()).toEqual(["papers/b/x/metadata.yaml: title: X", "papers/b/x/paper.pdf: PDF"]);
  });

  it("refuses a destination that exists and changes nothing", async () => {
    const { root, fs } = setup();
    await fs.writeText("papers/a/f", "1");
    await fs.writeText("papers/b/g", "2");
    await expect(fs.rename("papers/a", "papers/b")).rejects.toThrow(/already exists/);
    expect(root.dump()).toEqual(["papers/a/f: 1", "papers/b/g: 2"]);
  });

  it.each([false, true])("renames to another letter case without losing content (case-insensitive disk: %s)", async (insensitive) => {
    const { root, fs } = setup(insensitive);
    await fs.writeText("papers/ml/f", "1");
    await fs.rename("papers/ml", "papers/ML");
    expect(root.dump()).toEqual(["papers/ML/f: 1"]);
  });

  it("passes on the refusal of a folder the browser no longer lets it use", async () => {
    const fs = new DirectoryFileSystem(async () => { throw new Error("LabShelf may not use the folder"); });
    await expect(fs.readText("a.txt")).rejects.toThrow("may not use the folder");
    await expect(fs.writeText("a.txt", "x")).rejects.toThrow("may not use the folder");
  });
});
