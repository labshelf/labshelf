/** Verifies which pages of the full PDF a section covers, from the page its heading lands on and the page the next one starts on. */
import { deriveSectionPageRange } from "../../../../src/latex/build/section/index";
import type { SectionState } from "../../../../src/latex/build/section/index";

const at = (command: string, absolutePage: number, fillingPage = absolutePage): SectionState =>
  ({ command, absolutePage, fillingPage, line: 1, file: "main.tex", counters: {} });

describe("deriveSectionPageRange", () => {
  it("includes the page the next section starts on mid-page, which holds this section's tail", () => {
    expect(deriveSectionPageRange([at("section", 2), at("section", 4)], 0, 10)).toEqual({ start: 1, end: 3 });
  });

  it("starts on the page the heading lands on and ends before a next heading pushed to a fresh page", () => {
    expect(deriveSectionPageRange([at("section", 3, 2), at("section", 6, 5)], 0, 10)).toEqual({ start: 2, end: 4 });
  });

  it("ends on the page a next chapter clears, not on the chapter's own page", () => {
    expect(deriveSectionPageRange([at("chapter", 1), at("chapter", 6, 5)], 0, 10)).toEqual({ start: 0, end: 4 });
  });

  it("runs the last section to the end of the PDF", () => {
    expect(deriveSectionPageRange([at("section", 2), at("section", 4)], 1, 7)).toEqual({ start: 3, end: 6 });
  });

  it("caps both ends at the last page of a PDF shorter than the records", () => {
    expect(deriveSectionPageRange([at("section", 9), at("section", 12)], 0, 5)).toEqual({ start: 4, end: 4 });
  });
});


it("excludes the empty page on which the next isolated section starts", () => {
  const states = [at("section", 2), { ...at("section", 4), pageBoundary: true }];
  expect(deriveSectionPageRange(states, 0, 10)).toEqual({ start: 1, end: 2 });
});
