/** Documents the LaTeX re-indent: environments, brace groups and display math indent their body, verbatim stays as written. */
import { indentLatex } from "../../../src/latex/index";

const indent = (lines: string[]): string[] => indentLatex(lines.join("\n"), "  ").split("\n");

describe("indentLatex", () => {
  it("indents the body of every environment, the document's too", () => {
    expect(indent([
      "\\begin{document}",
      "    \\begin{itemize}",
      "\\item One",
      "        \\begin{enumerate}",
      "\\item Two",
      "\\end{enumerate}",
      "   \\end{itemize}",
      "\\end{document}",
    ])).toEqual([
      "\\begin{document}",
      "  \\begin{itemize}",
      "    \\item One",
      "    \\begin{enumerate}",
      "      \\item Two",
      "    \\end{enumerate}",
      "  \\end{itemize}",
      "\\end{document}",
    ]);
  });

  it("indents under each heading until the next of its level or higher, or the end of its environment", () => {
    expect(indent([
      "\\begin{document}",
      "\\section{One}\\label{sec:one}",
      "Text",
      "\\subsection*{Two}",
      "\\begin{figure}",
      "x",
      "\\end{figure}",
      "\\section[Short]{Three}",
      "More",
      "\\end{document}",
    ])).toEqual([
      "\\begin{document}",
      "  \\section{One}\\label{sec:one}",
      "    Text",
      "    \\subsection*{Two}",
      "      \\begin{figure}",
      "        x",
      "      \\end{figure}",
      "  \\section[Short]{Three}",
      "    More",
      "\\end{document}",
    ]);
  });

  it("indents an open brace group and display math until they close", () => {
    expect(indent([
      "\\newcommand{\\foo}{%",
      "bar",
      "}",
      "\\[",
      "x = 1",
      "\\]",
      "\\section{Long",
      "title}",
    ])).toEqual([
      "\\newcommand{\\foo}{%",
      "  bar",
      "}",
      "\\[",
      "  x = 1",
      "\\]",
      "\\section{Long",
      "  title}",
    ]);
  });

  it("ignores escaped braces, \\verb and comments", () => {
    expect(indent([
      "\\begin{center}",
      "a \\{ b \\verb|{| c % {",
      "d",
      "\\end{center}",
    ])).toEqual([
      "\\begin{center}",
      "  a \\{ b \\verb|{| c % {",
      "  d",
      "\\end{center}",
    ]);
  });

  it("keeps verbatim bodies and blanks empty lines", () => {
    expect(indent([
      "\\begin{figure}",
      "\\begin{verbatim}",
      "   keep {",
      "\\end{verbatim}",
      "   ",
      "\\end{figure}",
    ])).toEqual([
      "\\begin{figure}",
      "  \\begin{verbatim}",
      "   keep {",
      "  \\end{verbatim}",
      "",
      "\\end{figure}",
    ]);
  });
});
