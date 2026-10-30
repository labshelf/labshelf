// The fold ranges of LaTeX and Typst source: sections and headings up to the next of their level, environments up to their \end, and bracket groups over several lines.
import { EditorState } from "@codemirror/state";
import { findFoldRange } from "../../../../src/writing/dom/sourceEditor/folding";

function folded(text: string, line: number, language: "latex" | "typst"): string | null {
  const state = EditorState.create({ doc: text });
  const range = findFoldRange(state, state.doc.line(line).from, language);
  return range && state.sliceDoc(range.from, range.to);
}

describe("findFoldRange", () => {
  it("folds a LaTeX section up to the next section, keeping its trailing blank lines out", () => {
    const text = "\\section{A}\nbody\n\\subsection{B}\nmore\n\n\\section{C}\nend";
    expect(folded(text, 1, "latex")).toBe("\nbody\n\\subsection{B}\nmore");
    expect(folded(text, 3, "latex")).toBe("\nmore");
  });

  it("stops a section at \\end{document}", () => {
    expect(folded("\\section{A}\nbody\n\\end{document}", 1, "latex")).toBe("\nbody");
  });

  it("folds an environment up to the line before its \\end, across nested ones", () => {
    const text = "\\begin{itemize}\n\\begin{itemize}\n\\item a\n\\end{itemize}\n\\end{itemize}";
    expect(folded(text, 1, "latex")).toBe("\n\\begin{itemize}\n\\item a\n\\end{itemize}");
    expect(folded(text, 2, "latex")).toBe("\n\\item a");
  });

  it("does not fold an environment closed on its line, nor a commented \\begin", () => {
    expect(folded("\\begin{x}a\\end{x}\nb\nc", 1, "latex")).toBeNull();
    expect(folded("% \\begin{x}\nb\n\\end{x}", 1, "latex")).toBeNull();
  });

  it("folds a brace group over several lines up to its closer", () => {
    expect(folded("\\title{A\nB\nC}", 1, "latex")).toBe("\nB\nC");
    expect(folded("\\title{A\nB}", 1, "latex")).toBeNull();
  });

  it("folds a Typst heading up to the next heading of its level or above", () => {
    const text = "= A\nx\n== B\ny\n= C";
    expect(folded(text, 1, "typst")).toBe("\nx\n== B\ny");
    expect(folded(text, 3, "typst")).toBe("\ny");
  });

  it("folds a Typst block", () => {
    expect(folded("#let f() = {\n  a\n  b\n}", 1, "typst")).toBe("\n  a\n  b\n");
  });
});
