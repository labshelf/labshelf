/** Verifies how a highlight's page and text are written into LaTeX and Typst. */
import { pageSupplement, quotationBefore } from "../../../src/writing/citations/index";

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
