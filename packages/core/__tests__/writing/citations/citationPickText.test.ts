// Tests the picker words and the citation options of a highlight choice.
import type { Annotation, PaperRecord } from "../../../src/model/index";
import { choiceCitationOptions, highlightLabel, highlightPage, paperPickText } from "../../../src/writing/citations/index";

const highlight = (content: string, pageNumber = 4) => ({ type: "highlight", content, pageNumber }) as unknown as Annotation;

describe("paperPickText", () => {
  it("lists a paper by title, key, status and year", () => {
    const paper = { title: "T", citeKey: "k", status: "unread", year: 2020 } as unknown as PaperRecord;
    expect(paperPickText(paper)).toEqual({ label: "T", description: "@k", detail: "Unread · 2020" });
  });
});

describe("renderHighlightedHtml words", () => {
  it("flattens whitespace and cuts long text", () => {
    expect(highlightLabel(highlight("a \n  b"))).toBe("a b");
    expect(highlightLabel(highlight("x".repeat(200)))).toBe(`${"x".repeat(120)}…`);
    expect(highlightPage(highlight("a", 7))).toBe("p. 7");
  });
});

describe("choiceCitationOptions", () => {
  it("gives no options without a highlight, the page for a cite and the quotation for a quote", () => {
    const one = highlight("text", 9);
    expect(choiceCitationOptions({ quote: false })).toEqual({});
    expect(choiceCitationOptions({ highlight: one, quote: false })).toEqual({ page: 9 });
    expect(choiceCitationOptions({ highlight: one, quote: true })).toEqual({ page: 9, quotation: "text" });
  });
});
