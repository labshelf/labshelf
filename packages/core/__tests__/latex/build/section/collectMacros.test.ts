/** Verifies that the definitions a section needs are collected in source order, body only, without nested copies. */
import { extractDefinitions } from "../../../../src/latex/sectionPlan";
import { scanLatexSource } from "../../../../src/latex/source";

const collect = (text: string): string[] => extractDefinitions(text, scanLatexSource(text));

describe("extractDefinitions", () => {
  it("returns every kind of definition in source order", () => {
    const text = [
      "\\newcommand{\\R}{\\mathbb{R}}",
      "\\renewcommand\\vec[1]{\\mathbf{#1}}",
      "\\providecommand{\\x}{x}",
      "\\DeclareMathOperator{\\tr}{tr}",
      "\\def\\a#1{(#1)}",
      "\\gdef\\b{b}\\edef\\c{\\b}\\xdef\\d{\\c}",
      "\\let\\e=\\relax",
      "\\let\\f\\e",
      "\\theoremstyle{plain}",
      "\\newtheorem{thm}{Theorem}[section]",
      "\\newtheorem*{rem}{Remark}",
      "\\newtheorem{lem}[thm]{Lemma}",
      "\\newenvironment{box}[1][x]{\\begin{center}#1}{\\end{center}}",
      "\\newcounter{step}[section]",
      "\\newlength{\\gap}\\newlength\\gip",
    ].join("\n");
    expect(collect(text)).toEqual([
      "\\newcommand{\\R}{\\mathbb{R}}",
      "\\renewcommand\\vec[1]{\\mathbf{#1}}",
      "\\providecommand{\\x}{x}",
      "\\DeclareMathOperator{\\tr}{tr}",
      "\\def\\a#1{(#1)}",
      "\\gdef\\b{b}", "\\edef\\c{\\b}", "\\xdef\\d{\\c}",
      "\\let\\e=\\relax",
      "\\let\\f\\e",
      "\\theoremstyle{plain}",
      "\\newtheorem{thm}{Theorem}[section]",
      "\\newtheorem*{rem}{Remark}",
      "\\newtheorem{lem}[thm]{Lemma}",
      "\\newenvironment{box}[1][x]{\\begin{center}#1}{\\end{center}}",
      "\\newcounter{step}[section]",
      "\\newlength{\\gap}", "\\newlength\\gip",
    ]);
  });

  it("skips the preamble, which the format already holds", () => {
    const text = "\\documentclass{article}\n\\newcommand{\\p}{p}\n\\begin{document}\n\\newcommand{\\q}{q}\n";
    expect(collect(text)).toEqual(["\\newcommand{\\q}{q}"]);
  });

  it("keeps a definition nested in another once, inside its parent", () => {
    const text = "\\newenvironment{e}{\\newcommand{\\in}{i}\\def\\z{z}}{}\n\\newcommand{\\w}{\\def\\y{y}}";
    expect(collect(text)).toEqual(["\\newenvironment{e}{\\newcommand{\\in}{i}\\def\\z{z}}{}", "\\newcommand{\\w}{\\def\\y{y}}"]);
  });

  it("ignores commented-out definitions and does not match longer command names", () => {
    expect(collect("% \\def\\a{a}\n\\definecolor{x}{rgb}{0,0,0}\\letter\\newcounters")).toEqual([]);
  });
});
