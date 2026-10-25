/** Verifies how a highlight's page and text are written into LaTeX and Typst. */
import { createCitationSnippet, derivePageSupplement, deriveQuotationBefore } from "../../../src/writing/citations/index";

describe("derivePageSupplement", () => {
  it("keeps the page on the line of `p.` in LaTeX and uses a plain space in Typst", () => {
    expect(derivePageSupplement("latex", 4)).toBe("p.~4");
    expect(derivePageSupplement("typst", 4)).toBe("p. 4");
  });
});

describe("deriveQuotationBefore", () => {
  it("quotes with LaTeX quotation marks and a tie to the citation", () => {
    expect(deriveQuotationBefore("latex", "Attention is\n  all you need")).toBe("``Attention is all you need''~");
  });

  it("escapes the characters LaTeX reads as markup", () => {
    expect(deriveQuotationBefore("latex", "50% of a_b & #1 ~x")).toBe("``50\\% of a\\_b \\& \\#1 \\textasciitilde{}x''~");
  });

  it("quotes for Typst and escapes its markup characters", () => {
    expect(deriveQuotationBefore("typst", "uses #code and @ref")).toBe(String.raw`"uses \#code and \@ref" `);
  });
});

describe("createCitationSnippet", () => {
  it("writes a plain citation in each format", () => {
    expect(createCitationSnippet("latex", "vaswani17")).toBe("\\cite{vaswani17}");
    expect(createCitationSnippet("typst", "vaswani17")).toBe("@vaswani17");
  });

  it("adds the page as the citation's supplement", () => {
    expect(createCitationSnippet("latex", "k", { page: 4 })).toBe("\\cite[p.~4]{k}");
    expect(createCitationSnippet("typst", "k", { page: 4 })).toBe("@k[p. 4]");
  });

  it("puts the quotation before the citation", () => {
    expect(createCitationSnippet("latex", "k", { page: 4, quotation: "Attention" })).toBe("``Attention''~\\cite[p.~4]{k}");
    expect(createCitationSnippet("typst", "k", { page: 4, quotation: "Attention" })).toBe('"Attention" @k[p. 4]');
  });

  it("quotes without a page when the highlight has none", () => {
    expect(createCitationSnippet("latex", "k", { quotation: "x" })).toBe("``x''~\\cite{k}");
  });
});
