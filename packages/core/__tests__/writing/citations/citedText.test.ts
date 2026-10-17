/** Verifies how a highlight's page and text are written into LaTeX and Typst. */
import { citationSnippet, pageSupplement, quotationBefore } from "../../../src/writing/citations/index";

describe("pageSupplement", () => {
  it("keeps the page on the line of `p.` in LaTeX and uses a plain space in Typst", () => {
    expect(pageSupplement("latex", 4)).toBe("p.~4");
    expect(pageSupplement("typst", 4)).toBe("p. 4");
  });
});

describe("quotationBefore", () => {
  it("quotes with LaTeX quotation marks and a tie to the citation", () => {
    expect(quotationBefore("latex", "Attention is\n  all you need")).toBe("``Attention is all you need''~");
  });

  it("escapes the characters LaTeX reads as markup", () => {
    expect(quotationBefore("latex", "50% of a_b & #1 ~x")).toBe("``50\\% of a\\_b \\& \\#1 \\textasciitilde{}x''~");
  });

  it("quotes for Typst and escapes its markup characters", () => {
    expect(quotationBefore("typst", "uses #code and @ref")).toBe(String.raw`"uses \#code and \@ref" `);
  });
});

describe("citationSnippet", () => {
  it("writes a plain citation in each format", () => {
    expect(citationSnippet("latex", "vaswani17")).toBe("\\cite{vaswani17}");
    expect(citationSnippet("typst", "vaswani17")).toBe("@vaswani17");
  });

  it("adds the page as the citation's supplement", () => {
    expect(citationSnippet("latex", "k", { page: 4 })).toBe("\\cite[p.~4]{k}");
    expect(citationSnippet("typst", "k", { page: 4 })).toBe("@k[p. 4]");
  });

  it("puts the quotation before the citation", () => {
    expect(citationSnippet("latex", "k", { page: 4, quotation: "Attention" })).toBe("``Attention''~\\cite[p.~4]{k}");
    expect(citationSnippet("typst", "k", { page: 4, quotation: "Attention" })).toBe('"Attention" @k[p. 4]');
  });

  it("quotes without a page when the highlight has none", () => {
    expect(citationSnippet("latex", "k", { quotation: "x" })).toBe("``x''~\\cite{k}");
  });
});
