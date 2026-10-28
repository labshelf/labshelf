import type { LibraryFileSystem } from "@labshelf/core";
import { BridgeFileSystem, BridgeClient } from "../../src/storage/bridge";
import { DB_VERSION, IdbFileSystem, applyDbUpgrade, createIdbHistoryStorage } from "../../src/storage/idb";
import { clearFakeDb, fakeFiles, fakeRows, putFile, textAt } from "../support/fakeIdb";
import { FakeBridgeHost, silentLogger } from "./bridge/fakeBridgeHost";

jest.mock("webextension-polyfill", () => ({}));
jest.mock("idb", () => ({ openDB: async () => require("../support/fakeIdb").fakeDb }));

function fakeStore(indexes: string[]) {
  const names = new Set(indexes);
  return {
    rows: new Map<string, unknown>(),
    indexNames: { contains: (n: string) => names.has(n) },
    deleteIndex: jest.fn((n: string) => { names.delete(n); }),
  };
}

/** An in-memory database that holds stores by name, as the upgrade steps see it. */
function fakeDatabase(stores: Record<string, ReturnType<typeof fakeStore>>) {
  return {
    objectStoreNames: { contains: (n: string) => n in stores },
    createObjectStore: jest.fn((n: string) => { stores[n] = fakeStore([]); }),
    deleteObjectStore: jest.fn((n: string) => { delete stores[n]; }),
  };
}

describe("applyDbUpgrade", () => {
  it("creates the files, metadata and history stores in a new database", () => {
    const stores: Record<string, ReturnType<typeof fakeStore>> = {};
    const db = fakeDatabase(stores);
    applyDbUpgrade(db as never, 0, {} as never);
    expect(Object.keys(stores)).toEqual(["files", "metadata", "historyLog", "historyObjects"]);
  });

  it("drops the version 1 indexes and the sync manifest store of a version 1 database", () => {
    const files = fakeStore(["byHash"]);
    const metadata = fakeStore(["byFolder"]);
    const stores = { files, metadata, manifest: fakeStore([]) };
    const db = fakeDatabase(stores);
    applyDbUpgrade(db as never, 1, { objectStore: (n: string) => stores[n as keyof typeof stores] } as never);
    expect(files.deleteIndex).toHaveBeenCalledWith("byHash");
    expect(metadata.deleteIndex).toHaveBeenCalledWith("byFolder");
    expect(Object.keys(stores)).toEqual(["files", "metadata", "historyLog", "historyObjects"]);
  });

  it("removes the sync manifest store of a version 2 database and keeps the stored files and papers", () => {
    const files = fakeStore([]);
    const metadata = fakeStore([]);
    files.rows.set("papers/a/paper.pdf", { path: "papers/a/paper.pdf" });
    metadata.rows.set("a", { paperId: "a" });
    const manifest = fakeStore([]);
    manifest.rows.set("drive", { providerId: "drive", json: "{}" });
    const stores = { files, metadata, manifest };
    const db = fakeDatabase(stores);
    applyDbUpgrade(db as never, 2, {} as never);
    expect(Object.keys(stores)).toEqual(["files", "metadata", "historyLog", "historyObjects"]);
    expect(files.rows.size).toBe(1);
    expect(metadata.rows.size).toBe(1);
    expect(files.deleteIndex).not.toHaveBeenCalled();
    expect(DB_VERSION).toBe(4);
  });

  it("adds the history stores to a version 3 database without touching the others", () => {
    const files = fakeStore([]);
    const stores = { files, metadata: fakeStore([]) };
    const db = fakeDatabase(stores);
    applyDbUpgrade(db as never, 3, {} as never);
    expect(Object.keys(stores)).toEqual(["files", "metadata", "historyLog", "historyObjects"]);
  });
});

describe("IdbFileSystem", () => {
  const fs = new IdbFileSystem();

  beforeEach(() => fakeFiles.clear());

  describe("rename", () => {
    it("re-keys every row under a folder and keeps the bytes", async () => {
      putFile("papers/a/x/metadata.yaml", "title: X");
      putFile("papers/a/x/paper.pdf", "PDF");
      putFile("papers/ab/other.txt", "stays");

      await fs.rename("papers/a", "papers/b");

      expect([...fakeFiles.keys()].sort()).toEqual(["papers/ab/other.txt", "papers/b/x/metadata.yaml", "papers/b/x/paper.pdf"]);
      expect(textAt("papers/b/x/paper.pdf")).toBe("PDF");
    });

    it("renames a single file", async () => {
      putFile("papers/a.txt", "hello");
      await fs.rename("papers/a.txt", "papers/b.txt");
      expect([...fakeFiles.keys()]).toEqual(["papers/b.txt"]);
    });

    it("refuses a destination that exists and changes nothing", async () => {
      putFile("papers/a/f", "1");
      putFile("papers/b/g", "2");
      await expect(fs.rename("papers/a", "papers/b")).rejects.toThrow(/Already exists/);
      expect([...fakeFiles.keys()].sort()).toEqual(["papers/a/f", "papers/b/g"]);
    });

    it("renames a folder to the same name in another letter case", async () => {
      putFile("papers/ml/f", "1");
      await fs.rename("papers/ml", "papers/ML");
      expect([...fakeFiles.keys()]).toEqual(["papers/ML/f"]);
    });

    it("fails for a source that does not exist", async () => {
      await expect(fs.rename("papers/missing", "papers/b")).rejects.toThrow(/not found/);
    });
  });

  describe("trash", () => {
    it("deletes a folder with everything in it and leaves the neighbours", async () => {
      putFile("papers/a/f", "1");
      putFile("papers/a/deep/g", "2");
      putFile("papers/ab/h", "3");
      await fs.trash("papers/a");
      expect([...fakeFiles.keys()]).toEqual(["papers/ab/h"]);
    });
  });

  describe("mkdir", () => {
    it("makes an empty folder exist through a zero-byte .keep", async () => {
      await fs.mkdir("papers/New");
      expect(fakeFiles.get("papers/New/.keep")?.bytes.length).toBe(0);
      expect(await fs.stat("papers/New")).toMatchObject({ isDirectory: true });
    });
  });

  describe("text access", () => {
    it("round-trips text and reports existence of files and folders", async () => {
      await fs.writeText("papers/a/metadata.yaml", "title: Ü");
      expect(await fs.readText("papers/a/metadata.yaml")).toBe("title: Ü");
      expect(await fs.exists("papers/a")).toBe(true);
      expect(await fs.exists("papers/b")).toBe(false);
    });
  });
});

describe("createIdbHistoryStorage", () => {
  beforeEach(() => clearFakeDb());

  it("reads an empty log before anything was appended", async () => {
    expect(await createIdbHistoryStorage("p").readLog()).toBe("");
  });

  it("appends lines to the log of its own project only", async () => {
    const a = createIdbHistoryStorage("a");
    await a.appendLog("one\n");
    await a.appendLog("two\n");
    await createIdbHistoryStorage("b").appendLog("other\n");
    expect(await a.readLog()).toBe("one\ntwo\n");
    expect(fakeRows.historyLog.get("b")).toEqual({ projectId: "b", text: "other\n" });
  });

  it("stores objects by hash and shares them between projects", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    await createIdbHistoryStorage("a").writeObject("h1", bytes);
    expect(await createIdbHistoryStorage("b").hasObject("h1")).toBe(true);
    expect(await createIdbHistoryStorage("b").hasObject("h2")).toBe(false);
    expect(await createIdbHistoryStorage("b").readObject("h1")).toEqual(bytes);
  });

  it("fails reading an object that is missing", async () => {
    await expect(createIdbHistoryStorage("a").readObject("nope")).rejects.toThrow("nope");
  });
});

// Pins that both library sources answer a missing path the way the LocalFileSystem port promises.
describe("missing files", () => {

  beforeEach(() => fakeFiles.clear());

  function bridgeFs(): LibraryFileSystem {
    const link = new BridgeClient(() => new FakeBridgeHost(), silentLogger);
    return new BridgeFileSystem(async () => (await link.open()).connection);
  }

  describe.each([
    ["IndexedDB", () => new IdbFileSystem()],
    ["bridge", bridgeFs],
  ])("a missing path in %s", (_name, make: () => LibraryFileSystem) => {
    it("stats as undefined, does not exist and lists as empty", async () => {
      const fs = make();
      await expect(fs.stat("papers/gone/paper.pdf")).resolves.toBeUndefined();
      await expect(fs.exists("papers/gone")).resolves.toBe(false);
      await expect(fs.listDir("papers/gone")).resolves.toEqual([]);
    });

    it("rejects a read and deletes as a no-op", async () => {
      const fs = make();
      await expect(fs.readFile("papers/gone/paper.pdf")).rejects.toThrow("papers/gone/paper.pdf");
      await expect(fs.deleteFile("papers/gone/paper.pdf")).resolves.toBeUndefined();
      await expect(fs.trash("papers/gone")).resolves.toBeUndefined();
    });
  });
});
