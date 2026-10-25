import { DB_VERSION, applyDbUpgrade } from "../../src/storage/idbDatabase";

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
