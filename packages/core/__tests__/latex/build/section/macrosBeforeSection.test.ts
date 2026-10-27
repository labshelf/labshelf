/** Verifies that a section typeset alone gets the document-body definitions that come before it, in source order. */
import { extractDefinitionsBeforeSection } from "../../../../src/latex/sectionPlan";

describe("extractDefinitionsBeforeSection", () => {
  it("takes main's body definitions before the section and skips the preamble and what follows", () => {
    const main = "\\documentclass{article}\n\\newcommand{\\a}{a}\n\\begin{document}\n\\newcommand{\\b}{b}\n\\section{One}\n\\newcommand{\\c}{c}\n\\end{document}\n";
    expect(extractDefinitionsBeforeSection({ sources: { "main.tex": main }, main: "main.tex", editedFile: "main.tex", startLine: 4 }))
      .toEqual(["\\newcommand{\\b}{b}"]);
  });

  it("follows body inputs in order up to the edited file and ignores inputs of the preamble", () => {
    const sources = {
      "main.tex": "\\documentclass{article}\n\\input{pre}\n\\begin{document}\n\\input{defs}\n\\newcommand{\\m}{m}\n\\input{part}\n\\input{late}\n\\end{document}\n",
      "pre.tex": "\\newcommand{\\p}{p}\n",
      "defs.tex": "\\newcommand{\\d}{d}\n",
      "part.tex": "\\newcommand{\\q}{q}\n\\input{chapters/chap}\n\\newcommand{\\after}{x}\n",
      "chapters/chap.tex": "\\newcommand{\\e}{e}\n\\section{A}\n\\newcommand{\\f}{f}\n",
      "late.tex": "\\newcommand{\\l}{l}\n",
    };
    expect(extractDefinitionsBeforeSection({ sources, main: "main.tex", editedFile: "chapters/chap.tex", startLine: 1 }))
      .toEqual(["\\newcommand{\\d}{d}", "\\newcommand{\\m}{m}", "\\newcommand{\\q}{q}", "\\newcommand{\\e}{e}"]);
  });
});
