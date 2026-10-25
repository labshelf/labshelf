/** Verifies table sizes parse within the limit and tables expand to valid LaTeX and Typst source. */
import { parseTableSize, createTableSnippet } from "../../../src/writing/snippet/index";
import { expandSnippet } from "./snippetExpansion";

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
