/** Documents the word count: what counts as prose and what is skipped, on small fixtures. */
import { countWords } from "../../../src/latex/index";

const doc = (body: string): string => `\\documentclass{article}\n\\usepackage{amsmath}\n\\title{Not Counted}\n\\begin{document}\n${body}\n\\end{document}\n`;

describe("countWords", () => {
  it("counts only the body when the document environment is present", () => {
    expect(countWords(doc("One two three."))).toBe(3);
  });

  it("counts a whole fragment when there is no document environment", () => {
    expect(countWords("\\section{Intro} Some words here.")).toBe(4);
  });

  it("skips comments but keeps an escaped percent sign out of the words", () => {
    expect(countWords(doc("Real words % hidden words\n50\\% more"))).toBe(4);
  });

  it("skips command names but counts their text arguments and headings", () => {
    expect(countWords(doc("\\section{Related Work}\\textbf{bold} and \\emph{very important}"))).toBe(6);
  });

  it("skips inline, display and environment math", () => {
    const body = "a $x^2 + y$ b $$\\sum_i x_i$$ c \\(z\\) d \\[w\\] e\n\\begin{align*}f &= g\\\\ h &= i\\end{align*} f";
    expect(countWords(doc(body))).toBe(6);
  });

  it("does not take an escaped dollar for math", () => {
    expect(countWords(doc("costs \\$5 and \\$6 today"))).toBe(5);
  });

  it("skips labels, references, citations, packages and graphics paths", () => {
    const body = "see \\ref{sec:one} and \\cref{a,b} \\cite[p.~3]{smith2020} \\citep{x} \\includegraphics[width=3cm]{fig/photo}\\label{fig:x}";
    expect(countWords(doc(body))).toBe(2);
  });

  it("skips begin and end names and the options after begin", () => {
    expect(countWords(doc("\\begin{figure}[ht] caption text \\end{figure}\n\\begin{itemize}\\item first\\item second\\end{itemize}"))).toBe(4);
  });

  it("counts hyphenated words, contractions, numbers and accented words as one each", () => {
    expect(countWords(doc("state-of-the-art isn't 2024 M\\\"uller Caf\u00e9"))).toBe(5);
  });

  it("does not count verbatim code", () => {
    expect(countWords(doc("before \\begin{verbatim}lots of code here\\end{verbatim} after"))).toBe(2);
  });

  it("returns zero for an empty body", () => {
    expect(countWords(doc("  % only a comment"))).toBe(0);
  });
});
