/** Verifies that date and term writes refuse values the Space file readers would reject. */
import { seededFixture } from "./spaceStoreFixture";

const base = { version: 1, name: "S", folders: [], papers: [], projects: [], dates: [] };

describe("addDate validation", () => {
  it.each([
    ["an impossible day", { kind: "task", title: "t", date: "2026-13-45", done: false }],
    ["a day past the end of its month", { kind: "task", title: "t", date: "2026-02-30", done: false }],
    ["an empty paper id", { kind: "read", title: "t", date: "2026-01-01", paperIds: [""] }],
    ["an empty project id", { kind: "project", title: "t", date: "2026-01-01", projectId: "" }],
  ])("rejects %s without writing", async (_name, draft) => {
    const f = await seededFixture({ s: base });
    await expect(f.store.addDate("s", draft as never)).rejects.toThrow();
    expect((await f.json("s")).dates).toEqual([]);
  });
});

describe("addTerm validation", () => {
  it.each([
    ["page 0", { paperId: "p", page: 0 }],
    ["page 1.5", { paperId: "p", page: 1.5 }],
    ["an empty paper id", { paperId: "" }],
  ])("rejects a source with %s", async (_name, source) => {
    const f = await seededFixture({ s: base });
    await expect(f.store.addTerm("s", { term: "a", definition: "b", source })).rejects.toThrow();
    expect(await f.fs.exists("/lib/spaces/s/glossary.json")).toBe(false);
  });
});
