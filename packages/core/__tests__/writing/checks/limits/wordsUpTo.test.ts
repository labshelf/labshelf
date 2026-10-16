/** Verifies the word count of a root up to the References heading or the end of the document. */
import { wordsUpTo } from "../../../../src/writing/checks/limits";

const DOC = String.raw`\documentclass{article}
\begin{document}
one two three
\bibliographystyle{plain}
\bibliography{refs}
four five
\end{document}`;

describe("wordsUpTo", () => {
  it("stops at the bibliography command for references", () => {
    expect(wordsUpTo([{ text: DOC }], "references")).toBe(3);
  });

  it("stops at printbibliography and at the Typst bibliography call", () => {
    expect(wordsUpTo([{ text: String.raw`\begin{document} a b \printbibliography c d \end{document}` }], "references")).toBe(2);
    expect(wordsUpTo([{ text: "a b c\n#bibliography(\"refs.bib\")\nd e" }], "references")).toBe(3);
  });

  it("ignores a bibliography command in a comment", () => {
    expect(wordsUpTo([{ text: "a b\n% \\bibliography{x}\nc\n\\bibliography{x} d" }], "references")).toBe(3);
  });

  it("counts through the references for end and stops at the end of the document", () => {
    expect(wordsUpTo([{ text: DOC }], "end")).toBe(5);
  });

  it("counts a text without a bibliography in full", () => {
    expect(wordsUpTo([{ text: "a b c" }], "references")).toBe(3);
  });

  it("joins the sources in the order given, so an include before the bibliography counts", () => {
    const parts = [{ text: String.raw`\begin{document} a b` }, { text: "c d e" }, { text: String.raw`f \bibliography{r} g h \end{document}` }];
    expect(wordsUpTo(parts, "references")).toBe(6);
    expect(wordsUpTo(parts, "end")).toBe(8);
  });
});
