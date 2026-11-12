// Pins wrapLiveFileSystem: text reads and writes of a live path go through LiveFiles, everything else goes straight to the wrapped file system.
import type { LibraryFileSystem } from "@labshelf/core";
import type { LiveFiles } from "../../src/localSync/liveFiles";
import { wrapLiveFileSystem } from "../../src/localSync/liveFileSystem";

const PATH = "projects/p/main.tex";

function fakeFs() {
  const bytes = new Uint8Array([1, 2, 3]);
  const stat = { isFile: true, isDirectory: false, mtimeMs: 5, size: 3 };
  return {
    bytes,
    stat,
    fs: {
      readText: jest.fn(async (_path: string) => "from disk"),
      writeText: jest.fn(async (_path: string, _text: string) => undefined),
      readFile: jest.fn(async (_path: string) => bytes),
      writeFile: jest.fn(async (_path: string, _bytes: Uint8Array) => undefined),
      stat: jest.fn(async (_path: string) => stat),
      exists: jest.fn(async (_path: string) => true),
      listDir: jest.fn(async (_path: string) => ["a", "b"]),
      deleteFile: jest.fn(async (_path: string) => undefined),
      ensureDir: jest.fn(async (_path: string) => undefined),
      rename: jest.fn(async (_from: string, _to: string) => undefined),
      trash: jest.fn(async (_path: string) => undefined),
      removeTree: jest.fn(async (_path: string) => undefined),
      mkdir: jest.fn(async (_path: string) => undefined),
    },
  };
}

function fakeLive(options: { write?: boolean; read?: string | undefined } = {}) {
  return {
    libraryId: "lib1",
    open: jest.fn(),
    isLive: jest.fn(async () => true),
    write: jest.fn(async (_path: string, _text: string) => options.write ?? true),
    read: jest.fn(async (_path: string) => options.read),
    changed: jest.fn(),
    close: jest.fn(async () => undefined),
  };
}

const asFs = (fs: ReturnType<typeof fakeFs>["fs"]): LibraryFileSystem => fs as unknown as LibraryFileSystem;
const asLive = (live: ReturnType<typeof fakeLive>): LiveFiles => live as unknown as LiveFiles;

describe("wrapLiveFileSystem", () => {
  it("3.2d writeText of a live path goes through LiveFiles and not to the wrapped fs", async () => {
    const { fs } = fakeFs();
    const live = fakeLive({ write: true });
    const wrapped = wrapLiveFileSystem(asFs(fs), async () => asLive(live));
    await wrapped.writeText(PATH, "new text");
    expect(live.write).toHaveBeenCalledWith(PATH, "new text");
    expect(fs.writeText).not.toHaveBeenCalled();
  });

  it("3.2d writeText of a path that is not live goes to the wrapped fs", async () => {
    const { fs } = fakeFs();
    const live = fakeLive({ write: false });
    const wrapped = wrapLiveFileSystem(asFs(fs), async () => asLive(live));
    await wrapped.writeText(PATH, "new text");
    expect(live.write).toHaveBeenCalledWith(PATH, "new text");
    expect(fs.writeText).toHaveBeenCalledTimes(1);
    expect(fs.writeText).toHaveBeenCalledWith(PATH, "new text");
  });

  it("3.2d readText of a live path returns the replica text without reading the disk", async () => {
    const { fs } = fakeFs();
    const live = fakeLive({ read: "from replica" });
    const wrapped = wrapLiveFileSystem(asFs(fs), async () => asLive(live));
    expect(await wrapped.readText(PATH)).toBe("from replica");
    expect(live.read).toHaveBeenCalledWith(PATH);
    expect(fs.readText).not.toHaveBeenCalled();
  });

  it("3.2d readText of a live path whose replica is empty returns the empty text", async () => {
    const { fs } = fakeFs();
    const live = fakeLive({ read: "" });
    const wrapped = wrapLiveFileSystem(asFs(fs), async () => asLive(live));
    expect(await wrapped.readText(PATH)).toBe("");
    expect(fs.readText).not.toHaveBeenCalled();
  });

  it("3.2d readText of a path that is not live reads the wrapped fs", async () => {
    const { fs } = fakeFs();
    const live = fakeLive({ read: undefined });
    const wrapped = wrapLiveFileSystem(asFs(fs), async () => asLive(live));
    expect(await wrapped.readText(PATH)).toBe("from disk");
    expect(fs.readText).toHaveBeenCalledWith(PATH);
  });

  it("3.2d with live() resolving undefined, writeText and readText go straight to the wrapped fs", async () => {
    const { fs } = fakeFs();
    const wrapped = wrapLiveFileSystem(asFs(fs), async () => undefined);
    await wrapped.writeText(PATH, "text");
    expect(await wrapped.readText(PATH)).toBe("from disk");
    expect(fs.writeText).toHaveBeenCalledWith(PATH, "text");
    expect(fs.readText).toHaveBeenCalledWith(PATH);
  });

  it("3.2d with live() rejecting, writeText and readText go straight to the wrapped fs", async () => {
    const { fs } = fakeFs();
    const wrapped = wrapLiveFileSystem(asFs(fs), async () => { throw new Error("no live files"); });
    await wrapped.writeText(PATH, "text");
    expect(await wrapped.readText(PATH)).toBe("from disk");
    expect(fs.writeText).toHaveBeenCalledWith(PATH, "text");
  });

  it("3.2d writeFile, readFile and stat always go to the wrapped fs and never to LiveFiles", async () => {
    const { fs, bytes, stat } = fakeFs();
    const live = fakeLive({ write: true, read: "from replica" });
    const wrapped = wrapLiveFileSystem(asFs(fs), async () => asLive(live));
    const payload = new Uint8Array([9]);
    await wrapped.writeFile(PATH, payload);
    expect(await wrapped.readFile(PATH)).toBe(bytes);
    expect(await wrapped.stat(PATH)).toBe(stat);
    expect(fs.writeFile).toHaveBeenCalledWith(PATH, payload);
    expect(fs.readFile).toHaveBeenCalledWith(PATH);
    expect(fs.stat).toHaveBeenCalledWith(PATH);
    expect(live.write).not.toHaveBeenCalled();
    expect(live.read).not.toHaveBeenCalled();
  });

  it("3.2d every other method passes straight to the wrapped fs", async () => {
    const { fs } = fakeFs();
    const live = fakeLive();
    const wrapped = wrapLiveFileSystem(asFs(fs), async () => asLive(live));
    expect(await wrapped.exists("a")).toBe(true);
    expect(await wrapped.listDir("d")).toEqual(["a", "b"]);
    await wrapped.deleteFile("a");
    await wrapped.ensureDir("d");
    await wrapped.rename("a", "b");
    await wrapped.trash("a");
    await wrapped.removeTree("d");
    await wrapped.mkdir("d");
    expect(fs.exists).toHaveBeenCalledWith("a");
    expect(fs.listDir).toHaveBeenCalledWith("d");
    expect(fs.deleteFile).toHaveBeenCalledWith("a");
    expect(fs.ensureDir).toHaveBeenCalledWith("d");
    expect(fs.rename).toHaveBeenCalledWith("a", "b");
    expect(fs.trash).toHaveBeenCalledWith("a");
    expect(fs.removeTree).toHaveBeenCalledWith("d");
    expect(fs.mkdir).toHaveBeenCalledWith("d");
    expect(live.write).not.toHaveBeenCalled();
    expect(live.read).not.toHaveBeenCalled();
  });
});
