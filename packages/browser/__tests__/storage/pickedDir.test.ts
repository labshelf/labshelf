// Pins the picked library folder: its file system, the library id kept with it and when it counts as usable.
const rows = new Map<string, unknown>();
jest.mock("idb", () => ({
  openDB: async () => ({
    get: async (_store: string, key: string) => rows.get(key),
    put: async (_store: string, value: unknown, key: string) => { rows.set(key, value); },
  }),
}));

import { DirFileSystem, FolderAccessError, ensureFolderGranted, readPickedDir, readPickedDirId, writePickedDir } from "../../src/storage/pickedDir";
import { FakeDir } from "../support/fakeDirectoryHandle";

function setup(caseInsensitive = false) {
  const root = new FakeDir("Library", caseInsensitive);
  const fs = new DirFileSystem(async () => root as unknown as FileSystemDirectoryHandle);
  return { root, fs };
}

describe("DirFileSystem", () => {
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
    const fs = new DirFileSystem(async () => { throw new Error("LabShelf may not use the folder"); });
    await expect(fs.readText("a.txt")).rejects.toThrow("may not use the folder");
    await expect(fs.writeText("a.txt", "x")).rejects.toThrow("may not use the folder");
  });
});

const asHandle = (dir: FakeDir): FileSystemDirectoryHandle => dir as unknown as FileSystemDirectoryHandle;

beforeEach(() => rows.clear());

describe("picked folder library id", () => {
  it("gives a picked folder an id that later loads return", async () => {
    const papers = asHandle(new FakeDir("Papers"));
    await writePickedDir(papers);
    const id = await readPickedDirId();
    expect(id).toMatch(/^[\w-]{16,}$/);
    expect(await readPickedDirId()).toBe(id);
    expect(await readPickedDir()).toBe(papers);
  });

  it("keeps the id when the same folder is picked again and changes it for another folder", async () => {
    const papers = asHandle(new FakeDir("Papers"));
    await writePickedDir(papers);
    const first = await readPickedDirId();
    await writePickedDir(papers);
    expect(await readPickedDirId()).toBe(first);
    await writePickedDir(asHandle(new FakeDir("Papers")));
    expect(await readPickedDirId()).not.toBe(first);
  });

  it("gives a folder stored without an id one id and keeps it", async () => {
    rows.set("library", new FakeDir("Papers"));
    const id = await readPickedDirId();
    expect(id).toBeDefined();
    expect(await readPickedDirId()).toBe(id);
  });

  it("has no id when no folder was picked", async () => {
    expect(await readPickedDirId()).toBeUndefined();
  });
});

const handle = (state?: PermissionState) => ({
  name: "Papers",
  queryPermission: state && (async () => state),
}) as unknown as FileSystemDirectoryHandle;

describe("ensureFolderGranted", () => {
  it("returns a folder with read and write permission", async () => {
    const granted = handle("granted");
    await expect(ensureFolderGranted(granted)).resolves.toBe(granted);
  });

  it.each(["prompt", "denied"] as const)("refuses a folder whose permission is %s, naming it", async (state) => {
    const refused = ensureFolderGranted(handle(state));
    await expect(refused).rejects.toBeInstanceOf(FolderAccessError);
    await expect(ensureFolderGranted(handle(state))).rejects.toThrow(/"Papers"/);
  });

  it("lets a context without the permission API try the call itself", async () => {
    const bare = handle();
    await expect(ensureFolderGranted(bare)).resolves.toBe(bare);
  });
});
