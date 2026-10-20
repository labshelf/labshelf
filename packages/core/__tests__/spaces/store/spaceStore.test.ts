/** Verifies Space listing, creation, deletion, read-only refusal, change notification and re-reading before a write. */
import { seededFixture, ROOT, NOW } from "./spaceStoreFixture";

const base = { version: 1, name: "Thesis", folders: [], papers: [], projects: [], dates: [] };

describe("SpaceStore listing", () => {
  it("skips hidden entries and folders without space.json, and lists unreadable Spaces", async () => {
    const f = await seededFixture({ alpha: base, broken: base });
    await f.fs.writeText(`${ROOT}/spaces/broken/space.json`, "{ nope");
    await f.fs.writeText(`${ROOT}/spaces/.hidden/space.json`, JSON.stringify(base));
    await f.fs.ensureDir(`${ROOT}/spaces/empty`);
    await f.fs.writeText(`${ROOT}/spaces/stray.txt`, "x");
    const listed = await f.store.reload();
    expect(listed.map((r) => [r.state, "space" in r ? r.space.id : r.id])).toEqual([["ready", "alpha"], ["unreadable", "broken"]]);
    expect(f.store.list()).toEqual(listed);
  });

  it("logs each reader warning once per read, with the path", async () => {
    const f = await seededFixture({ alpha: { ...base, papers: [{ nope: 1 }] } });
    await f.store.read("alpha");
    const warns = f.logs.filter((l) => l.level === "WARN");
    expect(warns).toHaveLength(1);
    expect(JSON.stringify(warns[0])).toContain(`${ROOT}/spaces/alpha/space.json`);
  });
});

describe("SpaceStore createSpace and deleteSpace", () => {
  it("gives two Spaces with the same name two ids and writes createdAt from now", async () => {
    const f = await seededFixture({});
    const first = await f.store.createSpace("Thesis");
    const second = await f.store.createSpace("Thesis");
    expect([first, second]).toEqual(["thesis", "thesis-2"]);
    expect((await f.json("thesis-2")).createdAt).toBe(NOW);
    expect(f.store.list().map((r) => ("space" in r ? r.space.id : r.id))).toEqual(["thesis", "thesis-2"]);
  });

  it("moves the whole Space folder to the trash", async () => {
    const f = await seededFixture({ alpha: base });
    await f.store.reload();
    await f.store.deleteSpace("alpha");
    expect(f.fs.trashed).toEqual([`${ROOT}/spaces/alpha`]);
    expect(f.store.list()).toEqual([]);
  });
});

describe("SpaceStore writes", () => {
  it("fires onChange once per mutation and stops after unsubscribe", async () => {
    const f = await seededFixture({ alpha: base });
    const listener = jest.fn();
    const off = f.store.onChange(listener);
    await f.store.renameSpace("alpha", "New");
    await f.store.addPapers("alpha", ["p1", "p2"]);
    await f.store.createSpace("Other");
    expect(listener).toHaveBeenCalledTimes(3);
    off();
    await f.store.setPurpose("alpha", "why");
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("rejects mutations on a version 2 Space and logs the refusal", async () => {
    const f = await seededFixture({ alpha: { ...base, version: 2 } });
    const before = await f.fs.readText(`${ROOT}/spaces/alpha/space.json`);
    const listener = jest.fn();
    f.store.onChange(listener);
    await expect(f.store.renameSpace("alpha", "X")).rejects.toMatchObject({ name: "SpaceReadOnlyError" });
    expect(await f.fs.readText(`${ROOT}/spaces/alpha/space.json`)).toBe(before);
    expect(listener).not.toHaveBeenCalled();
    expect(f.logs.some((l) => l.level === "ERROR")).toBe(true);
  });

  it("rejects term mutations when the glossary is read-only", async () => {
    const f = await seededFixture({ alpha: base });
    await f.fs.writeText(`${ROOT}/spaces/alpha/glossary.json`, "[1]");
    await expect(f.store.addTerm("alpha", { term: "a", definition: "b" })).rejects.toMatchObject({ name: "SpaceReadOnlyError" });
    expect(await f.fs.readText(`${ROOT}/spaces/alpha/glossary.json`)).toBe("[1]");
  });

  it("keeps fields it does not touch when the file changed after the last read", async () => {
    const f = await seededFixture({ alpha: base });
    await f.store.read("alpha");
    await f.put("alpha", { ...base, remote: "kept", papers: [{ id: "far", focus: false }] });
    await f.store.renameSpace("alpha", "Renamed");
    const doc = await f.json("alpha");
    expect(doc).toMatchObject({ name: "Renamed", remote: "kept", papers: [{ id: "far" }] });
  });

  it("logs an ERROR with the path and rethrows with context when a mutation fails", async () => {
    const f = await seededFixture({ alpha: base });
    await expect(f.store.renameFolder("alpha", "missing", "X")).rejects.toThrow(/space\.json/);
    const error = f.logs.find((l) => l.level === "ERROR");
    expect(JSON.stringify(error)).toContain(`${ROOT}/spaces/alpha/space.json`);
  });

  it("logs each successful mutation at INFO with the space id", async () => {
    const f = await seededFixture({ alpha: base });
    await f.store.setPurpose("alpha", "why");
    expect(f.logs.find((l) => l.level === "INFO")?.context).toMatchObject({ spaceId: "alpha" });
  });
});
