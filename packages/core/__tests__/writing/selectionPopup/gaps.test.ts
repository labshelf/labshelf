/** Verifies where the source editor's insert strip goes: between blocks of a LaTeX or Typst file, never in a preamble or between lines of a paragraph. */
import { deriveInsertGaps } from "../../../src/index";

describe("deriveInsertGaps", () => {
  it("puts a gap on the blank line after a paragraph, none between its lines", () => {
    expect(deriveInsertGaps("latex", "One line.\nSame paragraph.\n\nNext paragraph.")).toEqual([
      { line: 2, blank: true }, { line: 4, blank: false },
    ]);
  });

  it("puts a gap after \\end{…} and a sectioning command even without a blank line", () => {
    const text = "\\section{R}\n\\begin{figure}\n  \\centering\n\\end{figure}\nText.";
    expect(deriveInsertGaps("latex", text)).toEqual([{ line: 1, blank: false }, { line: 4, blank: false }, { line: 5, blank: false }]);
  });

  it("skips the preamble and keeps the body between \\begin{document} and \\end{document}", () => {
    const text = "\\documentclass{article}\n\n\\usepackage{x}\n\\begin{document}\nHello.\n\\end{document}";
    expect(deriveInsertGaps("latex", text)).toEqual([{ line: 4, blank: false }, { line: 5, blank: false }]);
  });

  it("gives a run of blank lines one gap, on its first line", () => {
    expect(deriveInsertGaps("latex", "A.\n\n\n\nB.")).toEqual([{ line: 1, blank: true }, { line: 5, blank: false }]);
  });

  it("puts a gap after a Typst heading and after a paragraph", () => {
    expect(deriveInsertGaps("typst", "= Title\nText.\nMore.\n\nEnd.")).toEqual([
      { line: 1, blank: false }, { line: 3, blank: true }, { line: 5, blank: false },
    ]);
  });

  it("has no gap in an empty file", () => {
    expect(deriveInsertGaps("latex", "")).toEqual([]);
  });
});
