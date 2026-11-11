/** Verifies what the selection popup reads a selection as, and the edits of its contextual actions. */
import { deriveDisplayMath, deriveIncludeLine, deriveSelectionContext, findLabelOccurrences } from "../../../src/writing/selectionPopup/index";

/** The offsets of the first `|…|` span (or `|` cursor) in `marked`, and the text without the bars. */
function at(marked: string): { text: string; from: number; to: number } {
  const from = marked.indexOf("|");
  const rest = marked.slice(from + 1);
  const second = rest.indexOf("|");
  const text = marked.replace(/\|/g, "");
  return { text, from, to: second < 0 ? from : from + second };
}

describe("deriveSelectionContext", () => {
  it("classifies prose", () => {
    const { text, from, to } = at("Some |plain| words.");
    expect(deriveSelectionContext("latex", text, from, to).kind).toBe("prose");
  });

  it("finds the second key of a LaTeX cite list, and the page argument to insert", () => {
    const { text, from, to } = at("As shown \\citep{a,|b|}.");
    const context = deriveSelectionContext("latex", text, from, to);
    expect(context.kind).toBe("citation");
    expect(context.citation).toMatchObject({ key: "b", from, to });
    const brace = text.indexOf("{");
    expect(context.citation!.page).toEqual({ kind: "insert", at: brace, text: "[]", cursor: brace + 1 });
  });

  it("selects an existing LaTeX page argument", () => {
    const { text, from } = at("\\cite[p.~4]{|smith}");
    const context = deriveSelectionContext("latex", text, from, from);
    expect(context.citation?.key).toBe("smith");
    expect(context.citation?.page).toEqual({ kind: "select", from: 6, to: 10 });
  });

  it("takes a Typst @key of a known paper as a citation and another as a reference", () => {
    const { text, from, to } = at("See @|smith2020| and @fig.");
    expect(deriveSelectionContext("typst", text, from, to, { citeKeys: new Set(["smith2020"]) }).citation).toMatchObject({ key: "smith2020" });
    const fig = text.indexOf("fig");
    expect(deriveSelectionContext("typst", text, fig, fig + 3, { citeKeys: new Set(["smith2020"]) })).toMatchObject({ kind: "reference", reference: { name: "fig", definition: false } });
  });

  it("classifies \\ref, \\label and a Typst <label> as references", () => {
    const ref = at("See \\ref{|fig:a|}.");
    expect(deriveSelectionContext("latex", ref.text, ref.from, ref.to).reference).toMatchObject({ name: "fig:a", definition: false });
    const label = at("\\label{|eq:1}");
    expect(deriveSelectionContext("latex", label.text, label.from, label.to).reference).toMatchObject({ name: "eq:1", definition: true });
    const typst = at("= Intro <|intro|>");
    expect(deriveSelectionContext("typst", typst.text, typst.from, typst.to).reference).toMatchObject({ name: "intro", definition: true });
  });

  it("classifies math inside $…$, \\[…\\] and an equation environment", () => {
    const inline = at("Let $|x^2| + 1$ be.");
    const context = deriveSelectionContext("latex", inline.text, inline.from, inline.to);
    expect(context.kind).toBe("math");
    expect(context.inlineMath).toEqual({ from: 4, to: 13, bodyFrom: 5, bodyTo: 12 });
    const display = at("\\[ |a| \\]");
    expect(deriveSelectionContext("latex", display.text, display.from, display.to)).toEqual({ kind: "math" });
    const env = at("\\begin{equation}\n|a = b|\n\\end{equation}");
    expect(deriveSelectionContext("latex", env.text, env.from, env.to)).toEqual({ kind: "math" });
  });

  it("classifies a selection over two lines of prose as multiline", () => {
    const { text, from, to } = at("|First line.\nSecond| line.");
    expect(deriveSelectionContext("latex", text, from, to).kind).toBe("multiline");
  });
});

describe("selection popup edits", () => {
  it("turns inline math into display math", () => {
    const latex = "Let $x$ be";
    expect(deriveDisplayMath("latex", latex, { from: 4, to: 7, bodyFrom: 5, bodyTo: 6 })).toEqual({ from: 4, to: 7, insert: "\n\\begin{equation}\n  x\n\\end{equation}\n" });
    expect(deriveDisplayMath("typst", "$x$", { from: 0, to: 3, bodyFrom: 1, bodyTo: 2 })).toEqual({ from: 0, to: 3, insert: "$ x $" });
  });

  it("finds a label's definition and uses", () => {
    const text = "\\label{a} \\ref{a} \\cref{b,a} \\ref{ab}";
    expect(findLabelOccurrences("latex", text, "a").map((found) => found.definition)).toEqual([true, false, false]);
  });

  it("writes the include line", () => {
    expect(deriveIncludeLine("latex", "sections/intro.tex")).toBe("\\input{sections/intro}");
    expect(deriveIncludeLine("typst", "sections/intro.typ")).toBe("#include \"sections/intro.typ\"");
  });
});
