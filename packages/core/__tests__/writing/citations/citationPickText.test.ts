// Tests the picker words and the citation options of a highlight choice.
import type { Annotation, PaperRecord } from "../../../src/model/index";
import { deriveChoiceCitationSpec, formatHighlightLabel, formatHighlightPage, derivePaperPickText } from "../../../src/writing/citations/index";

const highlight = (content: string, pageNumber = 4) => ({ type: "highlight", content, pageNumber }) as unknown as Annotation;

describe("derivePaperPickText", () => {
  it("lists a paper by title, key, status and year", () => {
    const paper = { title: "T", citeKey: "k", status: "unread", year: 2020 } as unknown as PaperRecord;
    expect(derivePaperPickText(paper)).toEqual({ label: "T", description: "@k", detail: "Unread · 2020" });
  });
});

describe("renderHighlightedHtml words", () => {
  it("flattens whitespace and cuts long text", () => {
    expect(formatHighlightLabel(highlight("a \n  b"))).toBe("a b");
    expect(formatHighlightLabel(highlight("x".repeat(200)))).toBe(`${"x".repeat(120)}…`);
    expect(formatHighlightPage(highlight("a", 7))).toBe("p. 7");
  });
});

describe("deriveChoiceCitationSpec", () => {
  it("gives no options without a highlight, the page for a cite and the quotation for a quote", () => {
    const one = highlight("text", 9);
    expect(deriveChoiceCitationSpec({ quote: false })).toEqual({});
    expect(deriveChoiceCitationSpec({ highlight: one, quote: false })).toEqual({ page: 9 });
    expect(deriveChoiceCitationSpec({ highlight: one, quote: true })).toEqual({ page: 9, quotation: "text" });
  });
});
