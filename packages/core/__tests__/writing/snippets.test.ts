/** Verifies selection wrapping, table sizes and table snippets, and image placement in LaTeX and Typst sources. */
import { posixPathOps } from "../../src/path/index";
import { deriveSelectionWrap, parseTableSize, createTableSnippet, findFreeImageName, deriveImageBaseFolder } from "../../src/writing/snippets";
import { expandSnippet } from "./snippetExpansion";

describe("deriveSelectionWrap", () => {
  it.each([
    ["latex", "bold", "\\textbf{word}"],
    ["latex", "italic", "\\emph{word}"],
    ["typst", "bold", "*word*"],
    ["typst", "italic", "_word_"],
  ] as const)("wraps a selection in %s %s", (language, style, expected) => {
    expect(deriveSelectionWrap(language, style, "word")).toEqual({ text: expected });
  });

  it("inserts empty markers and puts the cursor between them", () => {
    expect(deriveSelectionWrap("latex", "bold", "")).toEqual({ text: "\\textbf{}", cursor: 8 });
    expect(deriveSelectionWrap("typst", "italic", "")).toEqual({ text: "__", cursor: 1 });
  });

  it("unwraps a selection that is exactly wrapped", () => {
    expect(deriveSelectionWrap("latex", "italic", "\\emph{a b}")).toEqual({ text: "a b" });
    expect(deriveSelectionWrap("typst", "bold", "*a b*")).toEqual({ text: "a b" });
  });

  it("wraps only the selection when it sits inside other markup", () => {
    expect(deriveSelectionWrap("latex", "bold", "a b")).toEqual({ text: "\\textbf{a b}" });
  });

  it("wraps text that merely starts and ends with the markers of separate spans", () => {
    expect(deriveSelectionWrap("latex", "bold", "\\textbf{a} and \\textbf{b}"))
      .toEqual({ text: "\\textbf{\\textbf{a} and \\textbf{b}}" });
    expect(deriveSelectionWrap("typst", "bold", "*a* and *b*")).toEqual({ text: "**a* and *b**" });
  });

  it("wraps a different style instead of unwrapping it", () => {
    expect(deriveSelectionWrap("latex", "bold", "\\emph{a}")).toEqual({ text: "\\textbf{\\emph{a}}" });
  });
});

describe("parseTableSize", () => {
  it.each([["3x2", { columns: 3, rows: 2 }], [" 4 × 1 ", { columns: 4, rows: 1 }], ["20X20", { columns: 20, rows: 20 }]])("reads %s", (input, size) => {
    expect(parseTableSize(input)).toEqual(size);
  });

  it.each(["", "3", "0x2", "21x1", "3x-1", "ax2"])("rejects %j", (input) => {
    expect(parseTableSize(input)).toBeUndefined();
  });
});

describe("createTableSnippet", () => {
  it("builds a LaTeX tabular with one row per table row and a tab stop per cell", () => {
    expect(expandSnippet(createTableSnippet("latex", { columns: 2, rows: 1 }))).toBe([
      "\\begin{table}[h]",
      "\t\\centering",
      "\t\\begin{tabular}{|c|c|}",
      "\t\t\\hline",
      "\t\tx & x \\\\",
      "\t\t\\hline",
      "\t\\end{tabular}",
      "\t\\caption{Caption}",
      "\t\\label{tab:label}",
      "\\end{table}",
      "",
    ].join("\n"));
  });

  it("numbers the caption and label after the last cell", () => {
    const snippet = createTableSnippet("typst", { columns: 2, rows: 2 });
    expect(snippet).toContain("[${4}],");
    expect(snippet).toContain("caption: [${5:Caption}]");
    expect(snippet).toContain("<tab:${6:label}>");
  });
});

describe("findFreeImageName", () => {
  it("keeps the name when it is free", async () => {
    expect(await findFreeImageName(posixPathOps, "/p/images", "fig.png", async () => false)).toBe("/p/images/fig.png");
  });

  it("appends the first free number when the name is taken", async () => {
    const taken = new Set(["/p/images/fig.png", "/p/images/fig-2.png"]);
    expect(await findFreeImageName(posixPathOps, "/p/images", "fig.png", async (path) => taken.has(path))).toBe("/p/images/fig-3.png");
  });
});

describe("deriveImageBaseFolder", () => {
  it("uses the main file's folder for LaTeX", () => {
    expect(deriveImageBaseFolder("latex", "/p", "paper/main.tex", "/p/paper/sec/a.tex", posixPathOps)).toBe("/p/paper");
  });

  it("uses the document's folder for Typst, or for LaTeX without a main file", () => {
    expect(deriveImageBaseFolder("typst", "/p", "main.typ", "/p/sec/a.typ", posixPathOps)).toBe("/p/sec");
    expect(deriveImageBaseFolder("latex", "/p", undefined, "/p/sec/a.tex", posixPathOps)).toBe("/p/sec");
  });
});
