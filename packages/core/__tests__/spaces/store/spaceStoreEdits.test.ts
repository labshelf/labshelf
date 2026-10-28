/** Verifies paper, folder, date and term mutations: idempotence, re-parenting and survival of unknown keys. */
import { seededFixture } from "./spaceStoreFixture";
import type { SpaceStore } from "../../../src/spaces/spaceStore";

const seed = () => ({
  version: 1, name: "S", future: "top", projects: ["pr"],
  folders: [{ id: "f1", name: "F", keep: 1 }, { id: "f2", name: "Child", parent: "f1", keep: 2 }],
  papers: [{ id: "p1", folder: "f1", focus: false, keep: 3 }, { id: "p2", folder: "f1", focus: false }],
  dates: [{ id: "d1", kind: "task", title: "t", date: "2026-01-01", done: false, keep: 4 }],
});

describe("paper and folder mutations", () => {
  it("addPapers is idempotent", async () => {
    const f = await seededFixture({ a: seed() });
    await f.store.addPapers("a", ["p9", "p9", "p1"], "f2");
    await f.store.addPapers("a", ["p9"]);
    const papers = (await f.json("a")).papers.map((p: { id: string }) => p.id);
    expect(papers).toEqual(["p1", "p2", "p9"]);
  });

  it("deleteFolder moves references and child folders to the parent", async () => {
    const f = await seededFixture({ a: seed() });
    await f.store.createFolder("a", "Top");
    await f.store.deleteFolder("a", "f1");
    const doc = await f.json("a");
    expect(doc.folders.map((x: { id: string }) => x.id)).not.toContain("f1");
    const child = doc.folders.find((x: { id: string }) => x.id === "f2");
    expect(child.parent).toBeUndefined();
    expect(child.keep).toBe(2);
    expect(doc.papers.map((p: { id: string; folder?: string }) => [p.id, p.folder])).toEqual([["p1", undefined], ["p2", undefined]]);
  });

  it("deleteFolder moves up to a non-root parent", async () => {
    const f = await seededFixture({ a: seed() });
    await f.store.createFolder("a", "Deep", "f2");
    const deep = (await f.json("a")).folders.find((x: { name: string }) => x.name === "Deep").id;
    await f.store.addPapers("a", ["p5"], deep);
    await f.store.deleteFolder("a", deep);
    const doc = await f.json("a");
    expect(doc.papers.find((p: { id: string }) => p.id === "p5").folder).toBe("f2");
  });
});

type Case = [string, (s: SpaceStore) => Promise<unknown>];
const cases: Case[] = [
  ["renameSpace", (s) => s.renameSpace("a", "N")],
  ["setPurpose", (s) => s.setPurpose("a", "why")],
  ["addPapers", (s) => s.addPapers("a", ["p7"])],
  ["setFocus", (s) => s.setFocus("a", "p1", true)],
  ["moveReference", (s) => s.moveReference("a", "p1", "f2")],
  ["removePaper", (s) => s.removePaper("a", "p2")],
  ["createFolder", (s) => s.createFolder("a", "New")],
  ["renameFolder", (s) => s.renameFolder("a", "f1", "G")],
  ["deleteFolder", (s) => s.deleteFolder("a", "f1")],
  ["linkProject", (s) => s.linkProject("a", "pr2")],
  ["unlinkProject", (s) => s.unlinkProject("a", "pr")],
  ["addDate", (s) => s.addDate("a", { kind: "deadline", title: "x", date: "2026-02-02" })],
  ["updateDate", (s) => s.updateDate("a", "d1", { kind: "task", title: "u", date: "2026-03-03", done: false })],
  ["setDone", (s) => s.setDone("a", "d1", true)],
  ["removeDate", (s) => s.removeDate("a", "d2")],
];

describe("unknown keys", () => {
  it.each(cases)("%s keeps unknown keys at the top level and inside entries", async (name, run) => {
    const f = await seededFixture({ a: { ...seed(), dates: [...seed().dates, { id: "d2", kind: "deadline", title: "z", date: "2026-01-02" }] } });
    await run(f.store);
    const doc = await f.json("a");
    expect(doc.future).toBe("top");
    expect(doc.papers.find((p: { id: string }) => p.id === "p1").keep).toBe(3);
    expect(doc.dates.find((d: { id: string }) => d.id === "d1").keep).toBe(4);
    if (name !== "deleteFolder") { expect(doc.folders.find((x: { id: string }) => x.id === "f1").keep).toBe(1); }
    expect(doc.folders.find((x: { id: string }) => x.id === "f2").keep).toBe(2);
  });

  it.each([
    ["addTerm", (s: SpaceStore) => s.addTerm("a", { term: "n", definition: "d" })],
    ["updateTerm", (s: SpaceStore) => s.updateTerm("a", "t1", { term: "u", definition: "d", source: { paperId: "p1", page: 2 } })],
    ["removeTerm", (s: SpaceStore) => s.removeTerm("a", "t2")],
  ])("%s keeps unknown keys in the glossary", async (_name, run) => {
    const f = await seededFixture({ a: seed() });
    await f.putGlossary("a", { version: 1, future: "g", terms: [
      { id: "t1", term: "a", definition: "b", keep: 5, source: { paperId: "p1", extra1: 1 } },
      { id: "t2", term: "c", definition: "d" },
    ] });
    await run(f.store);
    const doc = await f.json("a", "glossary.json");
    expect(doc.future).toBe("g");
    expect(doc.terms.find((t: { id: string }) => t.id === "t1").keep).toBe(5);
  });
});
