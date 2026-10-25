/** Verifies the order of a section document and the line offset that maps its problems back to the source. */
import { assembleSectionDocument } from "../../../../src/latex/build/section/index";

describe("assembleSectionDocument", () => {
  const state = { command: "section", absolutePage: 3, fillingPage: 3, line: 12, file: "main.tex", counters: { section: 2 } };

  it("leaves the aux to the kernel, loads definitions before restoring the counters, then the section", () => {
    const { text, headerLines } = assembleSectionDocument({
      formatName: "main-fmt",
      definitions: ["\\newcommand{\\R}{r}", "\\newtheorem{thm}{T}\n[section]"], state,
      sectionText: "\\section{B}\nbody",
    });
    expect(text).toBe(
      "%&main-fmt\n\\begin{document}\n"
      + "\\newcommand{\\R}{r}\n\\newtheorem{thm}{T}\n[section]\n"
      + "\\ifcsname c@section\\endcsname\\setcounter{section}{2}\\fi\n"
      + "\\section{B}\nbody\n\\end{document}\n",
    );
    expect(text).not.toContain("\\input");
    expect(headerLines).toBe(6);
    expect(text.split("\n")[headerLines]).toBe("\\section{B}");
  });

  it("counts the header without definitions", () => {
    const { text, headerLines } = assembleSectionDocument({
      formatName: "f", definitions: [], state: { ...state, counters: {} }, sectionText: "x",
    });
    expect(text.split("\n")[headerLines]).toBe("x");
  });
});
