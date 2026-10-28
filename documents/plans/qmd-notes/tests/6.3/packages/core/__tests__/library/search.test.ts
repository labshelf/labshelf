import { matchPaper, parseQuery, searchDoc, type PaperRecord } from "@labshelf/core";

import { entry, loadedStore } from "../support/libraryModelFixtures";

const TITLE = { key: "title", reverse: false } as const;

function rec(overrides: Partial<PaperRecord> = {}): PaperRecord {
  return { id: "p1", title: "Untitled", path: "/lib/papers/p1", citeKey: "p1", status: "unread", hasPdf: true, ...overrides };
}

const matches = (record: PaperRecord, notesText: string | undefined, query: string): boolean =>
  matchPaper(record, searchDoc(record, notesText === undefined ? {} : { notesText }), parseQuery(query)) > 0;

describe("searchDoc with notesText", () => {
  it("6.3a matches a word of the notes text with note:word", () => {
    expect(matches(rec(), "Remember the Eigenvalue trick", "note:eigenvalue")).toBe(true);
  });

  it("6.3a does not match note:word for a word absent from the notes text", () => {
    expect(matches(rec(), "Remember the trick", "note:eigenvalue")).toBe(false);
  });

  it("6.3a matches a word of the notes text with a plain word query", () => {
    expect(matches(rec(), "Remember the Eigenvalue trick", "eigenvalue")).toBe(true);
  });

  it("6.3a folds accents and case in the notes text", () => {
    expect(matches(rec(), "Revisão do Café", "note:cafe")).toBe(true);
    expect(matches(rec(), "Revisão do Café", "revisao")).toBe(true);
  });

  it("6.3a puts the notes text in the rest and the note field of the document", () => {
    const doc = searchDoc(rec(), { notesText: "Some NOTE body" });
    expect(doc.note).toBe("some note body");
    expect(doc.rest).toContain("some note body");
  });

  it("6.3a has:note is true when the notes text is non-blank", () => {
    expect(matches(rec(), "a thought", "has:note")).toBe(true);
    expect(matches(rec(), "a thought", "no:note")).toBe(false);
  });

  it("6.3a has:note is false when the notes text is missing, empty or blank", () => {
    expect(matches(rec(), undefined, "has:note")).toBe(false);
    expect(matches(rec(), "", "has:note")).toBe(false);
    expect(matches(rec(), "  \n\t ", "has:note")).toBe(false);
    expect(matches(rec(), "", "no:note")).toBe(true);
  });

  it("6.3a has:notes follows the notes text like has:note", () => {
    expect(matches(rec(), "a thought", "has:notes")).toBe(true);
    expect(matches(rec(), "", "has:notes")).toBe(false);
  });

  it("A4 ignores a stray note key on the record", () => {
    const legacy = { ...rec(), note: "legacyword" } as PaperRecord;
    expect(matches(legacy, undefined, "note:legacyword")).toBe(false);
    expect(matches(legacy, undefined, "legacyword")).toBe(false);
    expect(matches(legacy, undefined, "has:note")).toBe(false);
    expect(matches(legacy, "fresh text", "has:note")).toBe(true);
  });

  it("A4 takes note text only from notesText when the record also carries a note key", () => {
    const legacy = { ...rec(), note: "legacyword" } as PaperRecord;
    expect(searchDoc(legacy, { notesText: "fresh text" }).note).toBe("fresh text");
  });

  it("6.3b rejects a note key on PaperRecord at compile time", () => {
    // @ts-expect-error `note` is no longer a PaperRecord field
    const withNote: PaperRecord = rec({ note: "x" });
    expect(withNote).toBeDefined();
  });
});

describe("LibraryStore.setNotesText", () => {
  it("6.3a finds a paper by a word of its notes text", async () => {
    const store = await loadedStore([entry("p1", "", { title: "Plain title" }), entry("p2", "", { title: "Other" })]);
    const plain = store.paper("p1")!;
    expect(store.matcher("eigenvalue")(plain)).toBe(false);
    store.setNotesText(new Map([["p1", "The eigenvalue trick"]]));
    expect(store.matcher("eigenvalue")(plain)).toBe(true);
    expect(store.matcher("note:eigenvalue")(plain)).toBe(true);
    expect(store.search("eigenvalue", TITLE).map((e) => e.record.id)).toEqual(["p1"]);
  });

  it("6.3a has:note follows the notes text held per paper", async () => {
    const store = await loadedStore([entry("p1", "", { title: "A" }), entry("p2", "", { title: "B" })]);
    store.setNotesText(new Map([["p1", "something"], ["p2", "   "]]));
    expect(store.search("has:note", TITLE).map((e) => e.record.id)).toEqual(["p1"]);
    expect(store.search("no:note", TITLE).map((e) => e.record.id)).toEqual(["p2"]);
  });

  it("6.3a drops a paper from the results when its notes text is replaced", async () => {
    const store = await loadedStore([entry("p1", "", { title: "Plain" })]);
    const plain = store.paper("p1")!;
    store.setNotesText(new Map([["p1", "alpha"]]));
    expect(store.matcher("alpha")(plain)).toBe(true);
    store.setNotesText(new Map([["p1", "beta"]]));
    expect(store.matcher("alpha")(plain)).toBe(false);
    expect(store.matcher("beta")(plain)).toBe(true);
    store.setNotesText(new Map());
    expect(store.matcher("has:note")(plain)).toBe(false);
  });

  it("6.3a keeps notes text and annotation text independent", async () => {
    const store = await loadedStore([entry("p1", "", { title: "Plain" })]);
    const plain = store.paper("p1")!;
    store.setAnnotationText(new Map([["p1", "highlighted"]]));
    store.setNotesText(new Map([["p1", "noted"]]));
    expect(store.matcher("highlighted")(plain)).toBe(true);
    expect(store.matcher("noted")(plain)).toBe(true);
    expect(store.matcher("note:highlighted")(plain)).toBe(false);
  });

  it("A4 a store without notes text does not match has:note even if a record carries a note key", async () => {
    const legacy = entry("p1", "", { title: "Plain" });
    (legacy.record as unknown as Record<string, unknown>).note = "legacyword";
    const store = await loadedStore([legacy]);
    expect(store.matcher("legacyword")(store.paper("p1")!)).toBe(false);
    expect(store.matcher("has:note")(store.paper("p1")!)).toBe(false);
  });
});
