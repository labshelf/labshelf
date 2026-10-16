/** Verifies the generated labshelf-values.tex text, LaTeX escaping and the main file's input line. */
import { VALUES_HEADER, flattenValues, generateValuesFile, withValuesInput } from "../../../src/writing/values/index";
import { escapeLatex } from "../../../src/writing/values/valuesFile";

describe("generateValuesFile", () => {
  it("writes the header, the lookup macro and one definition per leaf", () => {
    const { leaves } = flattenValues("results.json", { acc: 0.91, nested: { n: 3, name: "bert", ok: false } });
    expect(generateValuesFile(leaves)).toBe([
      VALUES_HEADER,
      String.raw`\providecommand{\lsvalue}[1]{\ifcsname lsv@#1\endcsname\csname lsv@#1\endcsname\else ??\PackageWarning{labshelf}{Unknown value #1}\fi}`,
      String.raw`\expandafter\def\csname lsv@results.acc\endcsname{0.91}`,
      String.raw`\expandafter\def\csname lsv@results.nested.n\endcsname{3}`,
      String.raw`\expandafter\def\csname lsv@results.nested.name\endcsname{bert}`,
      String.raw`\expandafter\def\csname lsv@results.nested.ok\endcsname{false}`,
      "",
    ].join("\n"));
  });

  it("starts with the generated-file comment and gives only the macro when there are no leaves", () => {
    const lines = generateValuesFile([]).split("\n");
    expect(lines[0]).toBe(VALUES_HEADER);
    expect(lines).toHaveLength(3);
  });
});

describe("escapeLatex", () => {
  it("escapes every character LaTeX treats specially", () => {
    expect(escapeLatex(String.raw`_ % & # $ { } ~ ^ \ `)).toBe(
      String.raw`\_ \% \& \# \$ \{ \} \textasciitilde{} \textasciicircum{} \textbackslash{} `,
    );
  });

  it("turns line breaks into spaces and leaves plain text alone", () => {
    expect(escapeLatex("a\nb\r\nc")).toBe("a b c");
    expect(escapeLatex("Top-1 (%)")).toBe(String.raw`Top-1 (\%)`);
  });
});

describe("withValuesInput", () => {
  const document = "\\documentclass{article}\n\\usepackage{x}\n\\begin{document}\nHi\n\\end{document}\n";

  it("adds the input line before \\begin{document}", () => {
    const result = withValuesInput(document);
    expect(result.kind).toBe("added");
    expect(result.text).toBe("\\documentclass{article}\n\\usepackage{x}\n\\input{labshelf-values}\n\\begin{document}\nHi\n\\end{document}\n");
  });

  it("adds it once", () => {
    const first = withValuesInput(document).text;
    expect(withValuesInput(first)).toEqual({ kind: "present", text: first });
    expect(withValuesInput(document.replace("\\begin", "\\input{sub/labshelf-values.tex}\n\\begin")).kind).toBe("present");
  });

  it("does not count a commented input as loaded, nor a commented \\begin{document} as the place", () => {
    const text = "% \\input{labshelf-values}\n% \\begin{document}\n\\begin{document}\n";
    expect(withValuesInput(text).text).toBe("% \\input{labshelf-values}\n% \\begin{document}\n\\input{labshelf-values}\n\\begin{document}\n");
  });

  it("leaves a file without \\begin{document} as it was", () => {
    expect(withValuesInput("\\section{A}\n")).toEqual({ kind: "no-document", text: "\\section{A}\n" });
  });
});
