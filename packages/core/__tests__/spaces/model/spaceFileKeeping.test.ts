/** Verifies that space.json and glossary.json keep invalid entries and inherited-name keys, and refuse writes over wrong-typed top-level keys. */
import { parseGlossaryFile, parseSpaceFile, serializeGlossaryFile, serializeSpaceFile } from "../../../src/spaces/index";
import type { SpaceReadResult } from "../../../src/spaces/index";

const where = { id: "s", path: "spaces/s/space.json" };

function ready(result: SpaceReadResult): Extract<SpaceReadResult, { state: "ready" }> {
  if (result.state !== "ready") { throw new Error(`expected ready, got ${result.reason}`); }
  return result;
}

const read = (doc: unknown) => ready(parseSpaceFile(JSON.stringify(doc), where));
const roundTrip = (doc: unknown) => JSON.parse(serializeSpaceFile(read(doc).space));

describe("invalid entries", () => {
  it("hides them, warns, and writes them back unchanged after the valid entries", () => {
    const badFolder = { id: "f9", name: 3, colour: "red" };
    const meeting = { id: "d9", kind: "meeting", title: "Sync", date: "2026-10-22", room: "A" };
    const noId = { name: "No id" };
    const doc = {
      version: 1, name: "S",
      folders: [badFolder, { id: "f1", name: "Ok" }, noId],
      papers: [{ id: "p1", focus: "yes" }, { id: "p2" }],
      projects: [5, "pr1"],
      dates: [meeting, { id: "d1", kind: "deadline", title: "Due", date: "2026-11-14" }],
    };
    const result = read(doc);
    expect(result.space.folders.map((x) => x.id)).toEqual(["f1"]);
    expect(result.space.dates.map((x) => x.id)).toEqual(["d1"]);
    expect(result.warnings.length).toBe(5);
    const out = roundTrip(doc);
    expect(out.folders).toEqual([{ id: "f1", name: "Ok" }, badFolder, noId]);
    expect(out.papers).toEqual([{ id: "p2" }, { id: "p1", focus: "yes" }]);
    expect(out.projects).toEqual(["pr1", 5]);
    expect(out.dates).toEqual([{ id: "d1", kind: "deadline", title: "Due", date: "2026-11-14" }, meeting]);
  });

  it("does not re-emit later copies of a repeated id", () => {
    const out = roundTrip({ folders: [{ id: "f1", name: "A" }, { id: "f1", name: "B" }], projects: ["pr", "pr"] });
    expect(out.folders).toEqual([{ id: "f1", name: "A" }]);
    expect(out.projects).toEqual(["pr"]);
  });

  it("keeps invalid glossary terms after the valid ones", () => {
    const bad = { id: "t9", term: "x", definition: "d", source: { paperId: "p", page: 0 } };
    const doc = { version: 1, terms: [bad, { id: "t1", term: "a", definition: "b" }] };
    const { glossary } = parseGlossaryFile(JSON.stringify(doc));
    expect(glossary.terms.map((t) => t.id)).toEqual(["t1"]);
    expect(JSON.parse(serializeGlossaryFile(glossary)).terms).toEqual([{ id: "t1", term: "a", definition: "b" }, bad]);
  });
});

describe("wrong-typed top-level keys", () => {
  it.each([
    ["folders", { folders: { f1: { name: "A" } } }],
    ["papers", { papers: "p1" }],
    ["projects", { projects: {} }],
    ["dates", { dates: 3 }],
    ["name", { name: 3 }],
    ["purpose", { purpose: ["x"] }],
    ["createdAt", { createdAt: 5 }],
    ["version", { version: "2" }],
  ])("makes the Space read-only when %s has the wrong type", (key, doc) => {
    expect(read({ version: 1, ...doc }).readOnlyReason).toContain(key);
  });

  it("makes the glossary read-only when terms is not an array or version is not a number", () => {
    expect(parseGlossaryFile(JSON.stringify({ version: 1, terms: {} })).readOnlyReason).toContain("terms");
    expect(parseGlossaryFile(JSON.stringify({ version: "1", terms: [] })).readOnlyReason).toContain("version");
  });

  it("keeps a missing version writable", () => {
    expect(read({ name: "S" }).readOnlyReason).toBeUndefined();
  });
});

describe("unknown keys with inherited names", () => {
  it("round-trip constructor, toString and __proto__ at the top level and inside entries", () => {
    const text = '{"version":1,"name":"S","folders":[{"id":"f1","name":"A","toString":"t","__proto__":{"x":1}}],"constructor":"c","__proto__":[1]}';
    const out = JSON.parse(serializeSpaceFile(ready(parseSpaceFile(text, where)).space));
    expect(Object.hasOwn(out, "constructor") && out.constructor).toBe("c");
    expect(Object.getOwnPropertyDescriptor(out, "__proto__")?.value).toEqual([1]);
    const folder = out.folders[0];
    expect(Object.hasOwn(folder, "toString") && folder.toString).toBe("t");
    expect(Object.getOwnPropertyDescriptor(folder, "__proto__")?.value).toEqual({ x: 1 });
  });
});
