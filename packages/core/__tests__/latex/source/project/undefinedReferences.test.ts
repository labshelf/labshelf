/** Verifies references are checked against the labels of the whole project, not of their own file. */
import { scanLatexSource, undefinedRefs } from "../../../../src/latex/index";

describe("undefinedRefs", () => {
  it("accepts a label defined in another file and reports the rest with their file", () => {
    const files = [
      { path: "main.tex", facts: scanLatexSource("\\ref{a} \\cref{a,missing}") },
      { path: "a.tex", facts: scanLatexSource("\\label{a}\\ref{gone}") },
    ];
    expect(undefinedRefs(files).map((entry) => [entry.path, entry.ref.name])).toEqual([
      ["main.tex", "missing"], ["a.tex", "gone"],
    ]);
  });
});
