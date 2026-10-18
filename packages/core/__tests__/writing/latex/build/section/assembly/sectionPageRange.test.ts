/** Verifies which pages of the full PDF a section covers, from the pages its heading and the next one were recorded on. */
import { sectionPageRange } from "../../../../../../src/writing/latex/build/section/index";
import type { SectionState } from "../../../../../../src/writing/latex/build/section/index";

const at = (command: string, absolutePage: number): SectionState => ({ command, absolutePage, line: 1, file: "main.tex", counters: {} });

describe("sectionPageRange", () => {
  it("includes the page the next section starts on, which holds this section's tail", () => {
    expect(sectionPageRange([at("section", 2), at("section", 4)], 0, 10)).toEqual({ start: 1, end: 3 });
  });

  it("includes the page a next chapter is recorded on, since the record precedes its clearpage", () => {
    expect(sectionPageRange([at("chapter", 1), at("chapter", 5)], 0, 10)).toEqual({ start: 0, end: 4 });
  });

  it("runs the last section to the end of the PDF", () => {
    expect(sectionPageRange([at("section", 2), at("section", 4)], 1, 7)).toEqual({ start: 3, end: 6 });
  });

  it("caps both ends at the last page of a PDF shorter than the records", () => {
    expect(sectionPageRange([at("section", 9), at("section", 12)], 0, 5)).toEqual({ start: 4, end: 4 });
  });
});
