/** Verifies build problems read from real Tectonic and TeX Live (latexmk -file-line-error) transcripts. */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseTexLog } from "../../../../src/writing/latex/index";

function fixture(toolchain: "tectonic" | "texlive", name: string): string {
  return readFileSync(join(__dirname, "..", "..", "..", "fixtures", "texLogs", toolchain, `${name}.log`), "utf8");
}

const SPELLING = "Check the spelling, or load the package that defines it with \\usepackage.";

describe("parseTexLog on Tectonic logs", () => {
  it("finds nothing in a clean build", () => {
    expect(parseTexLog(fixture("tectonic", "ok"), "tectonic")).toEqual([]);
  });

  it("places an undefined command in the \\input file that holds it", () => {
    expect(parseTexLog(fixture("tectonic", "undef"), "tectonic")).toEqual([
      { severity: "error", message: "Unknown command \\badmacro.", hint: SPELLING, file: "chapters/intro", line: 3 },
    ]);
  });

  it("names a missing package and says the bundle lacks it", () => {
    const [problem] = parseTexLog(fixture("tectonic", "missingpkg"), "tectonic");
    expect(problem).toMatchObject({ severity: "error", message: 'Package "nonexistentpkgxyz" is not installed.', file: "main.tex", line: 3 });
    expect(problem!.hint).toContain("Tectonic's package bundle has no nonexistentpkgxyz.sty");
    expect(problem!.hint).toContain("tlmgr install nonexistentpkgxyz");
  });

  it("reports undefined references and citations as warnings, without the summary line", () => {
    expect(parseTexLog(fixture("tectonic", "refs"), "tectonic")).toEqual([
      { severity: "warning", message: 'Reference "sec:missing" has no matching \\label.', file: "main.tex", line: 5,
        kind: "undefinedReference", subject: "sec:missing" },
      {
        severity: "warning", message: 'Citation "knuth84" is not in any bibliography.',
        hint: "Cite it through the library completion, or add it to your own .bib file.", file: "main.tex", line: 5,
        kind: "undefinedCitation", subject: "knuth84",
      },
    ]);
  });

  it("reports an overfull line as info on the first line of its paragraph", () => {
    expect(parseTexLog(fixture("tectonic", "overfull"), "tectonic")).toEqual([
      { severity: "info", message: "A line sticks 108.5pt into the margin.", file: "main.tex", line: 3, kind: "overfull" },
    ]);
  });

  it("names an unknown environment", () => {
    expect(parseTexLog(fixture("tectonic", "envmath"), "tectonic")).toEqual([
      { severity: "error", message: 'Unknown environment "foo".', hint: SPELLING, file: "main.tex", line: 3 },
    ]);
  });
});

describe("parseTexLog on TeX Live logs", () => {
  it("reads every error of a run that keeps going, each in its own file", () => {
    expect(parseTexLog(fixture("texlive", "undef"), "pdflatex").map((p) => [p.file, p.line, p.message])).toEqual([
      ["chapters/intro.tex", 3, "Unknown command \\badmacro."],
      ["main.tex", 7, "Unknown command \\foobar."],
    ]);
  });

  it("gives the tlmgr command for a missing package and drops the emergency stop after it", () => {
    expect(parseTexLog(fixture("texlive", "missingpkg"), "pdflatex")).toEqual([{
      severity: "error", message: 'Package "nonexistentpkgxyz" is not installed.',
      hint: "Install it with `tlmgr install nonexistentpkgxyz`. The TeX Live package name is usually the file name.",
      file: "main.tex", line: 3,
    }]);
  });

  it("explains environment, nesting and math-mode errors", () => {
    expect(parseTexLog(fixture("texlive", "envmath"), "pdflatex").map((p) => [p.line, p.message])).toEqual([
      [3, 'Unknown environment "foo".'],
      [5, "\\begin{document} is closed by \\end{foo}."],
      [7, "A math symbol is outside math mode."],
      [8, "A math symbol is outside math mode."],
    ]);
  });

  it("tells a pdfLaTeX user that fontspec needs another engine", () => {
    expect(parseTexLog(fixture("texlive", "fontspec"), "pdflatex")).toEqual([{
      severity: "error", message: "This document needs XeLaTeX or LuaLaTeX.", hint: "Switch the compiler to XeLaTeX or LuaLaTeX.",
      file: "/usr/local/texlive/2026/texmf-dist/tex/latex/fontspec/fontspec.sty", line: 100,
    }]);
  });

  it("reads warnings and bad boxes like Tectonic's", () => {
    expect(parseTexLog(fixture("texlive", "refs"), "pdflatex").map((p) => p.message)).toEqual([
      'Reference "sec:missing" has no matching \\label.',
      'Citation "knuth84" is not in any bibliography.',
    ]);
    expect(parseTexLog(fixture("texlive", "overfull"), "pdflatex")).toEqual([
      { severity: "info", message: "A line sticks 109.6pt into the margin.", file: "main.tex", line: 3, kind: "overfull" },
    ]);
  });
});
