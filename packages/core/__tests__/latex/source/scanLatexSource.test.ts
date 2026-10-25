/** Verifies the source scan on labels, references, headings, macros and includes, including comments and nesting. */
import { macrosToMathJax, scanLatexSource, stripComments } from "../../../src/latex/index";

const at = (line: number, character: number) => ({ line, character });

describe("stripComments", () => {
  it("blanks a comment to the line end and keeps the length", () => {
    const text = "a % note\nb";
    expect(stripComments(text)).toBe("a       \nb");
  });

  it("keeps an escaped percent sign and still ends a comment after an escaped backslash", () => {
    expect(stripComments("50\\% off")).toBe("50\\% off");
    expect(stripComments("x\\\\% gone")).toBe("x\\\\      ");
  });
});

describe("labels and references", () => {
  it("places a label name, ignoring commented-out ones", () => {
    const facts = scanLatexSource("% \\label{old}\n\\section{A}\\label{sec:a}\n");
    expect(facts.labels).toEqual([{ name: "sec:a", range: { start: at(1, 18), end: at(1, 23) } }]);
  });

  it("reads the whole ref family, starred forms included", () => {
    const facts = scanLatexSource("\\ref{a} \\eqref{b} \\autoref*{c} \\pageref{d} \\nameref{e} \\vref{f}");
    expect(facts.refs.map((ref) => [ref.command, ref.name])).toEqual([
      ["ref", "a"], ["eqref", "b"], ["autoref", "c"], ["pageref", "d"], ["nameref", "e"], ["vref", "f"],
    ]);
  });

  it("gives each name of a cref list its own range", () => {
    const facts = scanLatexSource("see \\Cref{fig:a, fig:b,tab:c}");
    expect(facts.refs).toEqual([
      { command: "Cref", name: "fig:a", range: { start: at(0, 10), end: at(0, 15) } },
      { command: "Cref", name: "fig:b", range: { start: at(0, 17), end: at(0, 22) } },
      { command: "Cref", name: "tab:c", range: { start: at(0, 23), end: at(0, 28) } },
    ]);
  });

  it("ignores a longer command that starts like a ref command and macro parameters", () => {
    const facts = scanLatexSource("\\refx{a} \\newcommand{\\see}[1]{\\ref{#1}}");
    expect(facts.refs).toEqual([]);
  });
});

describe("sections", () => {
  it("reads level, star and a title with nested braces", () => {
    const facts = scanLatexSource("\\subsection*{On $\\mathbb{R}^{n}$ and {braces}}\n");
    expect(facts.sections).toEqual([{
      command: "subsection", level: 2, starred: true, title: "On $\\mathbb{R}^{n}$ and {braces}",
      range: { start: at(0, 0), end: at(0, 46) },
    }]);
  });

  it("drops the optional short title and joins a title broken over lines", () => {
    const [section] = scanLatexSource("\\chapter[Short]{A long\n  title}").sections;
    expect(section).toMatchObject({ level: 0, title: "A long title" });
  });

  it("does not treat \\partial or an unclosed title as a heading", () => {
    expect(scanLatexSource("\\partial x \\section{open").sections).toEqual([]);
  });
});

describe("includes", () => {
  it("reads input, include and subfile with the path as written", () => {
    const facts = scanLatexSource("\\input{ chapters/a }\n\\include{b}\n\\subfile{c/d.tex}\n% \\input{gone}");
    expect(facts.includes.map((include) => [include.command, include.path])).toEqual([
      ["input", "chapters/a"], ["include", "b"], ["subfile", "c/d.tex"],
    ]);
    expect(facts.includes[0]!.range).toEqual({ start: at(0, 8), end: at(0, 18) });
  });
});

describe("macros", () => {
  it("reads braced and bare names, argument counts and defaults", () => {
    const facts = scanLatexSource([
      "\\newcommand{\\R}{\\mathbb{R}}",
      "\\renewcommand*\\vec[1]{\\mathbf{#1}}",
      "\\providecommand{\\pair}[2][0]{(#1, #2)}",
    ].join("\n"));
    expect(facts.macros.map(({ command, name, argCount, defaultArg, body }) => ({ command, name, argCount, defaultArg, body }))).toEqual([
      { command: "newcommand", name: "R", argCount: 0, defaultArg: undefined, body: "\\mathbb{R}" },
      { command: "renewcommand", name: "vec", argCount: 1, defaultArg: undefined, body: "\\mathbf{#1}" },
      { command: "providecommand", name: "pair", argCount: 2, defaultArg: "0", body: "(#1, #2)" },
    ]);
  });

  it("turns DeclareMathOperator into \\operatorname, with the star kept", () => {
    const facts = scanLatexSource("\\DeclareMathOperator{\\Tr}{Tr}\n\\DeclareMathOperator*{\\argmax}{arg\\,max}");
    expect(facts.macros.map((macro) => [macro.name, macro.body])).toEqual([
      ["Tr", "\\operatorname{Tr}"], ["argmax", "\\operatorname*{arg\\,max}"],
    ]);
  });

  it("converts macros to MathJax's record, later definitions winning and provide never overriding", () => {
    const { macros } = scanLatexSource([
      "\\newcommand{\\a}{1}", "\\newcommand{\\a}{2}", "\\providecommand{\\a}{3}",
      "\\newcommand{\\b}[2]{#1#2}", "\\newcommand{\\c}[1][x]{#1}",
    ].join("\n"));
    expect(macrosToMathJax(macros)).toEqual({ a: "2", b: ["#1#2", 2], c: ["#1", 1, "x"] });
  });
});
