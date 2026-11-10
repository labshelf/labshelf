/** Verifies what a citation's scope adds to its hover and preview card: the passage, the note, the abstract or the page's marks, with the fallbacks of a deleted highlight or note. */
import type { Annotation, PaperRecord } from "../../../src/model/index";
import { parseItemFile } from "../../../src/qmd/index";
import { deriveCitationEntries, deriveScopedCitationContent } from "../../../src/writing/citations/index";

const highlight = (id: string, page: number, content: string, type: Annotation["type"] = "highlight"): Annotation => ({
  id, paperId: "p", type, pageNumber: page, content, createdAt: "2026-01-01", updatedAt: "2026-01-01",
});

const annotations = [
  highlight("h1", 4, "  Attention is all you need.  "),
  highlight("h2", 4, `${"w".repeat(150)}`),
  highlight("h3", 5, "Other page"),
  highlight("c1", 4, "A comment, not a highlight", "comment"),
];
const longNote = "n".repeat(700);
const notes = parseItemFile([
  '::: {#n1 .labshelf-item anchor="p4 point 0.5 0.5"}', "My reading of page four", ":::", "",
  '::: {#n2 .labshelf-item anchor="hl:h3"}', longNote, ":::", "",
  "::: {#n3 .labshelf-item}", "Loose thought", ":::", "",
].join("\n"));
const paper = { id: "p", citeKey: "k", title: "T", summary: "  A long abstract   that is kept whole. ".repeat(20) } as unknown as PaperRecord;

describe("deriveScopedCitationContent", () => {
  it("gives a highlight's full text and page", () => {
    expect(deriveScopedCitationContent({ kind: "highlight", annotationId: "h1", page: 4 }, paper, annotations, notes))
      .toEqual({ kind: "highlight", title: "Cited passage, p. 4", page: 4, body: "Attention is all you need." });
  });

  it("falls back to the page of a deleted highlight", () => {
    expect(deriveScopedCitationContent({ kind: "highlight", annotationId: "gone", page: 5 }, paper, annotations, notes))
      .toEqual(deriveScopedCitationContent({ kind: "page", page: 5 }, paper, annotations, notes));
  });

  it("gives a passage's stored text and page", () => {
    expect(deriveScopedCitationContent({ kind: "passage", page: 2, text: "Selected words" }, paper, annotations, notes))
      .toEqual({ kind: "passage", title: "Cited passage, p. 2", page: 2, body: "Selected words" });
  });

  it("gives the first 600 characters of a note and its page", () => {
    expect(deriveScopedCitationContent({ kind: "note", noteId: "n2", page: 5 }, paper, annotations, notes))
      .toEqual({ kind: "note", title: "Cited note, p. 5", page: 5, body: `${"n".repeat(600)}…` });
    expect(deriveScopedCitationContent({ kind: "note", noteId: "n3" }, paper, annotations, notes))
      .toEqual({ kind: "note", title: "Cited note", body: "Loose thought" });
  });

  it("falls back to the page, else the paper, for a deleted note", () => {
    expect(deriveScopedCitationContent({ kind: "note", noteId: "gone", page: 4 }, paper, annotations, notes))
      .toEqual(deriveScopedCitationContent({ kind: "page", page: 4 }, paper, annotations, notes));
    expect(deriveScopedCitationContent({ kind: "note", noteId: "gone" }, paper, annotations, notes))
      .toEqual(deriveScopedCitationContent({ kind: "paper" }, paper, annotations, notes));
  });

  it("gives the whole abstract for the paper, and no body without one", () => {
    const whole = deriveScopedCitationContent({ kind: "paper" }, paper, annotations, notes);
    expect(whole).toEqual({ kind: "paper", title: "Abstract", body: paper.summary!.replace(/\s+/g, " ").trim() });
    expect(deriveScopedCitationContent({ kind: "paper" }, { ...paper, summary: "  " }, [], undefined)).toEqual({ kind: "paper", title: "Abstract" });
  });

  it("gives a page's highlights and notes, cut to 140 characters", () => {
    expect(deriveScopedCitationContent({ kind: "page", page: 4 }, paper, annotations, notes)).toEqual({
      kind: "page", title: "Cited page, p. 4", page: 4,
      marks: [
        { kind: "highlight", text: "Attention is all you need." },
        { kind: "highlight", text: `${"w".repeat(140)}…` },
        { kind: "note", text: "My reading of page four" },
      ],
    });
    expect(deriveScopedCitationContent({ kind: "page", page: 9 }, paper, annotations, notes)).toEqual({ kind: "page", title: "Cited page, p. 9", page: 9, marks: [] });
  });
});

describe("deriveCitationEntries with scopes", () => {
  const papers = [{ id: "p", citeKey: "k", title: "T", authors: [], status: "unread", path: "papers/p" } as unknown as PaperRecord];

  it("adds the scope content of a key and leaves the entries alone without scopes", () => {
    const scoped = deriveScopedCitationContent({ kind: "page", page: 4 }, paper, annotations, notes);
    const plain = deriveCitationEntries(["k"], papers);
    expect(plain[0]).not.toHaveProperty("scoped");
    expect(deriveCitationEntries(["k"], papers, { scoped: new Map([["k", scoped]]) })).toEqual([{ ...plain[0], scoped }]);
  });
});
