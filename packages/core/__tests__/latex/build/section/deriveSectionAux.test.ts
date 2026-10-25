/** Verifies that the aux copy a section loads keeps references and drops the lines that would write tables or bibliography setup. */
import { deriveSectionAux } from "../../../../src/latex/build/section/index";

describe("deriveSectionAux", () => {
  it("keeps labels, cites and nested aux inputs, drops writefile, contentsline and bib setup", () => {
    const aux = [
      "\\relax",
      "\\@writefile{toc}{\\contentsline {section}{\\numberline {1}A}{1}{}\\protected@file@percent }",
      "\\contentsline {section}{A}{1}",
      "\\newlabel{sec:a}{{1}{1}}",
      "\\bibstyle{plain}",
      "\\citation{knuth}",
      "\\bibcite{knuth}{1}",
      "\\bibdata{refs}",
      "\\@input{chap.aux}",
      "",
    ].join("\n");
    expect(deriveSectionAux(aux)).toBe(
      "\\relax\n\\newlabel{sec:a}{{1}{1}}\n\\citation{knuth}\n\\bibcite{knuth}{1}\n\\@input{chap.aux}\n",
    );
  });
});
