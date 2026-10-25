/** Verifies the checklist.json parser, the valid-item view, the immutable edits and the serializer. */
import {
  addManualItem, listManualItems, parseChecklistFile, removeManualItem, serializeChecklistFile, setManualItemDone,
} from "../../../src/writing/checklist/index";

const T0 = "2026-10-16T09:12:00.000Z";
const T1 = "2026-10-17T10:00:00.000Z";
const item = { id: "a", text: "Ask Ana", done: false, createdAt: T0 };

function parsed(value: unknown) {
  const doc = parseChecklistFile(JSON.stringify(value));
  if (doc === undefined) { throw new Error("expected a document"); }
  return doc;
}

describe("parseChecklistFile", () => {
  it("parses a valid file", () => {
    expect(listManualItems(parsed({ items: [item] }))).toEqual([item]);
  });

  it("reads malformed files as undefined", () => {
    expect(parseChecklistFile("not json")).toBeUndefined();
    expect(parseChecklistFile("[]")).toBeUndefined();
    expect(parseChecklistFile("null")).toBeUndefined();
    expect(parseChecklistFile('"x"')).toBeUndefined();
    expect(parseChecklistFile("{}")).toBeUndefined();
    expect(parseChecklistFile('{"items":{}}')).toBeUndefined();
  });
});

describe("listManualItems", () => {
  it("returns only valid items", () => {
    const done = { id: "d", text: "Done one", done: true, createdAt: T0, doneAt: T1 };
    const doc = parsed({
      items: [
        item, done,
        { ...item, id: "" }, { ...item, text: "" }, { ...item, id: 3 }, { ...item, done: "no" },
        { ...item, createdAt: "yesterday" }, { id: "x", text: "t", done: false },
        { ...item, id: "e", doneAt: "garbage" }, { ...done, id: "f", doneAt: "garbage" },
        null, "str", 4,
      ],
    });
    expect(listManualItems(doc).map((entry) => entry.id)).toEqual(["a", "d"]);
  });

  it("hides a done item that has no doneAt and an open item that has one", () => {
    const doc = parsed({ items: [{ ...item, done: true }, { ...item, id: "b", doneAt: T1 }] });
    expect(listManualItems(doc)).toEqual([]);
  });
});

describe("edits", () => {
  it("adds an item without mutating the input", () => {
    const doc = parsed({ items: [item] });
    const before = JSON.stringify(doc);
    const next = addManualItem(doc, { id: "b", text: "Shorten", now: T1 });
    expect(listManualItems(next)).toEqual([item, { id: "b", text: "Shorten", done: false, createdAt: T1 }]);
    expect(JSON.stringify(doc)).toBe(before);
  });

  it("marks an item done with doneAt and reopens it clearing doneAt", () => {
    const doc = parsed({ items: [item] });
    const before = JSON.stringify(doc);
    const done = setManualItemDone(doc, "a", true, T1);
    expect(listManualItems(done)).toEqual([{ ...item, done: true, doneAt: T1 }]);
    const reopened = setManualItemDone(done, "a", false, "2026-10-18T00:00:00.000Z");
    expect(listManualItems(reopened)).toEqual([item]);
    expect("doneAt" in listManualItems(reopened)[0]!).toBe(false);
    expect(JSON.stringify(doc)).toBe(before);
  });

  it("removes an item and leaves the others", () => {
    const doc = parsed({ items: [item, { ...item, id: "b" }] });
    const before = JSON.stringify(doc);
    expect(listManualItems(removeManualItem(doc, "a")).map((entry) => entry.id)).toEqual(["b"]);
    expect(JSON.stringify(doc)).toBe(before);
  });

  it("ignores an unknown id", () => {
    const doc = parsed({ items: [item] });
    expect(listManualItems(setManualItemDone(doc, "zzz", true, T1))).toEqual([item]);
    expect(listManualItems(removeManualItem(doc, "zzz"))).toEqual([item]);
  });

  it("keeps invalid items and unknown keys at the top level and in items", () => {
    const bad = { id: "bad", done: "maybe" };
    const doc = parsed({ extra: 1, items: [{ ...item, note: "keep" }, bad] });
    const next = removeManualItem(setManualItemDone(addManualItem(doc, { id: "n", text: "New", now: T1 }), "a", true, T1), "n");
    const out = JSON.parse(serializeChecklistFile(next));
    expect(out.extra).toBe(1);
    expect(out.items).toEqual([{ ...item, note: "keep", done: true, doneAt: T1 }, bad]);
  });
});

describe("group", () => {
  it("writes the group an item is added to and reads it back", () => {
    const doc = addManualItem(parsed({ items: [] }), { id: "g", text: "Fix fig 2", now: T0, group: "figure" });
    expect(listManualItems(parsed(JSON.parse(serializeChecklistFile(doc))))).toEqual([{ id: "g", text: "Fix fig 2", done: false, createdAt: T0, group: "figure" }]);
  });

  it("reads an unknown or malformed group as My items and keeps it on disk", () => {
    const doc = parsed({ items: [{ ...item, group: "someday" }, { ...item, id: "b", group: 3 }] });
    expect(listManualItems(doc)).toEqual([item, { ...item, id: "b" }]);
    expect(setManualItemDone(doc, "a", true, T1).items[0]).toMatchObject({ group: "someday" });
  });

  it("adds an item without a group as My items", () => {
    expect(addManualItem(parsed({ items: [] }), { id: "a", text: "Ask Ana", now: T0 }).items).toEqual([item]);
  });
});

describe("section", () => {
  it("writes the section an item is added to and reads it back", () => {
    const doc = addManualItem(parsed({ items: [] }), { id: "s", text: "Cut intro", now: T0, section: "main.tex#Intro" });
    expect(listManualItems(parsed(JSON.parse(serializeChecklistFile(doc))))).toEqual([{ id: "s", text: "Cut intro", done: false, createdAt: T0, section: "main.tex#Intro" }]);
  });

  it("reads an empty, non-string or over-long section as absent and keeps it on disk", () => {
    const doc = parsed({ items: [{ ...item, section: "" }, { ...item, id: "b", section: 3 }, { ...item, id: "c", section: "x".repeat(201) }] });
    expect(listManualItems(doc)).toEqual([item, { ...item, id: "b" }, { ...item, id: "c" }]);
    expect(setManualItemDone(doc, "a", true, T1).items[0]).toMatchObject({ section: "" });
  });
});

describe("serializeChecklistFile", () => {
  it("round-trips through parse", () => {
    const doc = addManualItem(parsed({ extra: true, items: [item] }), { id: "b", text: "Two", now: T1 });
    const text = serializeChecklistFile(doc);
    expect(JSON.parse(text)).toEqual({ extra: true, items: [item, { id: "b", text: "Two", done: false, createdAt: T1 }] });
    expect(serializeChecklistFile(parsed(JSON.parse(text)))).toBe(text);
  });
});
