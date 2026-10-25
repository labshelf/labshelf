// Tests which highlights are quoted beside a citation and in what order.
import type { Annotation } from "../../../src/model/index.js";
import { quotedHighlights } from "../../../src/writing/quotes/index.js";

const note = (over: Partial<Annotation>): Annotation => ({
  id: "a", paperId: "p", type: "highlight", pageNumber: 1, content: "text",
  createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", ...over,
});

describe("quotedHighlights", () => {
  it("keeps highlights with text, by page then creation, up to the limit", () => {
    const picked = quotedHighlights([
      note({ content: "late", pageNumber: 9 }),
      note({ content: "second", pageNumber: 2, createdAt: "2026-01-03T00:00:00Z" }),
      note({ content: "first", pageNumber: 2, createdAt: "2026-01-02T00:00:00Z" }),
      note({ content: "  ", pageNumber: 1 }),
      note({ type: "note", content: "a note", pageNumber: 1 }),
      note({ content: "fourth", pageNumber: 5 }),
    ], 3);
    expect(picked).toEqual([{ text: "first", page: 2 }, { text: "second", page: 2 }, { text: "fourth", page: 5 }]);
  });

  it("returns nothing for a paper without highlights", () => {
    expect(quotedHighlights([], 3)).toEqual([]);
  });

  it("keeps the colour of a highlight", () => {
    expect(quotedHighlights([note({ content: "x", color: "yellow" })], 3)).toEqual([{ text: "x", page: 1, color: "yellow" }]);
  });

  it("puts the highlights of the cited page first and applies the limit after", () => {
    const picked = quotedHighlights([
      note({ content: "p1", pageNumber: 1 }),
      note({ content: "p2", pageNumber: 2 }),
      note({ content: "p9b", pageNumber: 9, createdAt: "2026-01-02T00:00:00Z" }),
      note({ content: "p9a", pageNumber: 9 }),
    ], 3, 9);
    expect(picked.map((h) => h.text)).toEqual(["p9a", "p9b", "p1"]);
  });
});
