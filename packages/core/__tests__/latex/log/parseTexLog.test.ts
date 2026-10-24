/** Verifies build problems read from real TeX Live (latexmk -file-line-error) transcripts. */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseTexLog } from "../../../src/latex/index";

function fixture(name: string): string {
  return readFileSync(join(__dirname, "..", "..", "fixtures", "texLogs", "texlive", `${name}.log`), "utf8");
}

describe("parseTexLog on TeX Live logs", () => {
  it("finds nothing in a clean build", () => {
    expect(parseTexLog("(./main.tex)\nOutput written on main.pdf (1 page).\n", "pdflatex")).toEqual([]);
  });

  it("reads every error of a run that keeps going, each in its own file", () => {
    expect(parseTexLog(fixture("undef"), "pdflatex").map((p) => [p.file, p.line, p.message])).toEqual([
      ["chapters/intro.tex", 3, "Unknown command \\badmacro."],
      ["main.tex", 7, "Unknown command \\foobar."],
    ]);
  });

  it("gives the tlmgr command for a missing package and drops the emergency stop after it", () => {
    expect(parseTexLog(fixture("missingpkg"), "pdflatex")).toEqual([{
      severity: "error", message: 'Package "nonexistentpkgxyz" is not installed.',
      hint: "Install it with `tlmgr install nonexistentpkgxyz`. The TeX Live package name is usually the file name.",
      file: "main.tex", line: 3,
    }]);
  });

  it("explains environment, nesting and math-mode errors", () => {
    expect(parseTexLog(fixture("envmath"), "pdflatex").map((p) => [p.line, p.message])).toEqual([
      [3, 'Unknown environment "foo".'],
      [5, "\\begin{document} is closed by \\end{foo}."],
      [7, "A math symbol is outside math mode."],
      [8, "A math symbol is outside math mode."],
    ]);
  });

  it("tells a pdfLaTeX user that fontspec needs another engine", () => {
    expect(parseTexLog(fixture("fontspec"), "pdflatex")).toEqual([{
      severity: "error", message: "This document needs XeLaTeX or LuaLaTeX.", hint: "Switch the compiler to XeLaTeX or LuaLaTeX.",
      file: "/usr/local/texlive/2026/texmf-dist/tex/latex/fontspec/fontspec.sty", line: 100,
    }]);
  });

  it("reads undefined references and citations without the summary line, and overfull lines as info", () => {
    expect(parseTexLog(fixture("refs"), "pdflatex").map((p) => p.message)).toEqual([
      'Reference "sec:missing" has no matching \\label.',
      'Citation "knuth84" is not in any bibliography.',
    ]);
    expect(parseTexLog(fixture("overfull"), "pdflatex")).toEqual([
      { severity: "info", message: "A line sticks 109.6pt into the margin.", file: "main.tex", line: 3, kind: "overfull" },
    ]);
  });
});
