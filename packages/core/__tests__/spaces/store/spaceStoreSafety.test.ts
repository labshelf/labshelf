/** Verifies that Space writes run one at a time, space ids are guarded, and timestamps are whole seconds. */
import { seededFixture, ROOT } from "./spaceStoreFixture";
import { SpaceStore } from "../../../src/spaces/store/index";
import { posixPathOps } from "../../../src/library/mutations/index";
import { MemoryLibraryFs } from "../../support/memoryLibraryFs";

const base = { version: 1, name: "S", folders: [], papers: [], projects: [], dates: [] };
const withTask = { ...base, dates: [{ id: "d1", kind: "task", title: "t", date: "2026-01-01", done: false }] };

describe("SpaceStore serialises writes", () => {
  it("keeps both changes of two concurrent mutations of one Space", async () => {
    const f = await seededFixture({ s: withTask });
    await Promise.all([f.store.addPapers("s", ["a"]), f.store.setDone("s", "d1", true)]);
    const doc = await f.json("s");
    expect(doc.papers.map((p: { id: string }) => p.id)).toEqual(["a"]);
    expect(doc.dates[0].done).toBe(true);
  });

  it("keeps writing after a failed mutation", async () => {
    const f = await seededFixture({ s: withTask });
    const failing = f.store.setDone("s", "missing", true);
    const next = f.store.addPapers("s", ["a"]);
    await expect(failing).rejects.toThrow();
    await next;
    expect((await f.json("s")).papers).toHaveLength(1);
  });

  it("gives two concurrent createSpace calls with one name two ids", async () => {
    const f = await seededFixture({});
    const ids = await Promise.all([f.store.createSpace("X"), f.store.createSpace("X")]);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) { expect((await f.json(id)).name).toBe("X"); }
  });
});

describe("SpaceStore guards space ids", () => {
  it.each(["", "..", ".", "a/b", "a\\b", ".x"])("rejects %j and logs an ERROR", async (id) => {
    const f = await seededFixture({ s: base });
    await expect(f.store.renameSpace(id, "N")).rejects.toThrow(/space id/i);
    await expect(f.store.read(id)).rejects.toThrow(/space id/i);
    await expect(f.store.addTerm(id, { term: "a", definition: "b" })).rejects.toThrow(/space id/i);
    expect(f.logs.some((l) => l.level === "ERROR")).toBe(true);
  });

  it("deleteSpace never trashes with an invalid id or a folder without space.json", async () => {
    const f = await seededFixture({});
    await f.fs.ensureDir(`${ROOT}/spaces/stray`);
    await expect(f.store.deleteSpace("")).rejects.toThrow();
    await expect(f.store.deleteSpace("stray")).rejects.toThrow(/does not exist/);
    expect(f.fs.trashed).toEqual([]);
  });
});

describe("SpaceStore glossary writes respect the Space", () => {
  it("rejects addTerm on a version 2 Space without writing the glossary", async () => {
    const f = await seededFixture({ s: { ...base, version: 2 } });
    await expect(f.store.addTerm("s", { term: "a", definition: "b" })).rejects.toMatchObject({ name: "SpaceReadOnlyError" });
    expect(await f.fs.exists(`${ROOT}/spaces/s/glossary.json`)).toBe(false);
  });

  it("rejects addTerm on an unreadable Space", async () => {
    const f = await seededFixture({});
    await f.fs.writeText(`${ROOT}/spaces/s/space.json`, "{ nope");
    await expect(f.store.addTerm("s", { term: "a", definition: "b" })).rejects.toThrow(/unreadable/);
    expect(await f.fs.exists(`${ROOT}/spaces/s/glossary.json`)).toBe(false);
  });
});

describe("SpaceStore default clock", () => {
  it("writes createdAt to the second", async () => {
    const logger = { log: async () => undefined, error: async () => undefined };
    const fs = new MemoryLibraryFs();
    const store = new SpaceStore({ root: ROOT, fs, paths: posixPathOps, logger });
    const id = await store.createSpace("T");
    const doc = JSON.parse(await fs.readText(`${ROOT}/spaces/${id}/space.json`));
    expect(doc.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });
});
