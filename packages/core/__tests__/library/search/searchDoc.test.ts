import { searchDoc, type PaperRecord } from "@labshelf/core";

function rec(overrides: Partial<PaperRecord> = {}): PaperRecord {
  return { id: "p1", title: "Untitled", path: "/lib/papers/p1", citeKey: "p1", status: "unread", hasPdf: true, ...overrides };
}

describe("searchDoc", () => {
  it("folds title and authors and keeps the folded tags", () => {
    const doc = searchDoc(rec({ title: "Schrödinger", authors: ["José Müller", "Ann Lee"], tags: ["NLP", "Vision"] }));
    expect(doc.title).toBe("schrodinger");
    expect(doc.authors).toBe("jose muller; ann lee");
    expect(doc.tags).toEqual(["nlp", "vision"]);
  });

  it("puts annotation text in the rest of the document", () => {
    expect(searchDoc(rec(), { annotations: "Highlighted TEXT" }).rest).toContain("highlighted text");
  });

  it("puts the folder in the rest of the document", () => {
    expect(searchDoc(rec(), { folder: "Robotics / Control" }).rest).toContain("robotics / control");
  });

  it("keeps a folded text per field for field operators", () => {
    const doc = searchDoc(rec({ citeKey: "Smith2020", journal: "Nature", publisher: "Springer", keywords: ["Café"], summary: "Abstract" }), { notesText: "Note" });
    expect(doc).toMatchObject({ citeKey: "smith2020", venue: "nature; springer", keywords: "cafe", summary: "abstract", note: "note" });
  });

  it("handles a record without authors, tags or optional fields", () => {
    const doc = searchDoc(rec({ id: "x", citeKey: "x" }));
    expect(doc.authors).toBe("");
    expect(doc.tags).toEqual([]);
    expect(doc.rest).toBe("x\nx");
  });
});
