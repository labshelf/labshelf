// Tests recording, restoring and the row and diff views of a project's history over in-memory storage.
import { readHistoryDiff, readHistoryRows, readHistory, writeSnapshot, applySnapshot, type HistoryStorage, type HistoryProject } from "../../../src/writing/history/index";
import { fakeLogger } from "../../support/fakeLogger";
import { MemoryLibraryFs } from "../../support/memoryLibraryFs";

function memoryStorage(): HistoryStorage & { log: string; objects: Map<string, Uint8Array> } {
  const store = {
    log: "",
    objects: new Map<string, Uint8Array>(),
    async readLog() { return store.log; },
    async appendLog(line: string) { store.log += line; },
    async hasObject(hash: string) { return store.objects.has(hash); },
    async readObject(hash: string) { return store.objects.get(hash)!; },
    async writeObject(hash: string, bytes: Uint8Array) { store.objects.set(hash, bytes); },
  };
  return store;
}

const pathOps = {
  sep: "/",
  join: (...parts: string[]) => parts.join("/").replace(/\/+/g, "/"),
  dirname: (target: string) => target.slice(0, target.lastIndexOf("/")) || "/",
};

async function setup() {
  const fs = new MemoryLibraryFs();
  const storage = memoryStorage();
  const target = { project: { fs, paths: pathOps }, folder: "/p", storage } as unknown as HistoryProject;
  await fs.writeText("/p/main.tex", "one\n");
  await fs.writeText("/p/main.pdf", "%PDF built");
  await fs.writeFile("/p/figure.bin", new Uint8Array([1, 0, 2]));
  await fs.writeText("/p/.labshelf/state.json", "{}");
  return { fs, storage, target, logger: fakeLogger() };
}

describe("history over a storage port", () => {
  it("records sources by SHA-256, skips the built PDF and hidden folders, and ignores an unchanged edit", async () => {
    const { target, logger, storage } = await setup();
    const first = await writeSnapshot(target, "edit", logger);
    expect(Object.keys(first!.files)).toEqual(["figure.bin", "main.tex"]);
    // sha256("one\n")
    expect(first!.files["main.tex"]).toBe("2c8b08da5ce60398e1f19af0e5dccc744df274b826abe585eaba68c525434806");
    expect(storage.objects.size).toBe(2);
    expect(await writeSnapshot(target, "edit", logger)).toBeUndefined();
  });

  it("restores an earlier entry, deletes later files and keeps the replaced state", async () => {
    const { fs, target, logger } = await setup();
    const start = (await writeSnapshot(target, "edit", logger))!;
    await fs.writeText("/p/main.tex", "two\n");
    await fs.writeText("/p/sections/new.tex", "added");
    await applySnapshot(target, start.id, logger);
    expect(await fs.readText("/p/main.tex")).toBe("one\n");
    expect(await fs.exists("/p/sections/new.tex")).toBe(false);
    expect((await readHistory(target.storage, logger)).map((entry) => entry.kind)).toEqual(["edit", "edit", "restore"]);
  });

  it("lists rows newest first and diffs text, nothing for an unknown entry and null for binary", async () => {
    const { fs, target, logger, storage } = await setup();
    await writeSnapshot(target, "edit", logger);
    await fs.writeText("/p/main.tex", "one\ntwo\n");
    await fs.writeFile("/p/figure.bin", new Uint8Array([9, 0]));
    const second = (await writeSnapshot(target, "edit", logger))!;
    const rows = await readHistoryRows(storage, logger);
    expect(rows.map((row) => row.id)[0]).toBe(second.id);
    expect(rows[0]!.changes.map((change) => change.path)).toEqual(["figure.bin", "main.tex"]);
    expect((await readHistoryDiff(storage, second.id, "main.tex", logger))!.some((line) => line.kind === "added")).toBe(true);
    expect(await readHistoryDiff(storage, second.id, "figure.bin", logger)).toBeNull();
    expect(await readHistoryDiff(storage, "missing", "main.tex", logger)).toEqual([]);
  });
});
