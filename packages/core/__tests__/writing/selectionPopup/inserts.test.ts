/** Verifies what a click in a LaTeX or Typst source lands on, and the new list item and table row the bubble inserts. */
import { deriveInsertContext, deriveListItem, deriveTableRow } from "../../../src/index";

const at = (marked: string): [string, number] => [marked.replace("|", ""), marked.indexOf("|")];

describe("deriveInsertContext", () => {
  it.each([
    ["latex", "Some |prose here.", "inline"],
    ["latex", "Para.\n|\nMore.", "blankLine"],
    ["latex", "Let $x = |y$ hold.", "math"],
    ["latex", "\\begin{itemize}\n  \\item one|\n\\end{itemize}", "list"],
    ["latex", "\\begin{tabular}{ll}\n  a & b \\\\|\n\\end{tabular}", "table"],
    ["latex", "\\begin{itemize}\n\\end{itemize}\nAfter| it.", "inline"],
    ["latex", "% a comment|", undefined],
    ["typst", "Some |prose.", "inline"],
    ["typst", "- one|", "list"],
    ["typst", "Let $x|$ hold.", "math"],
    ["typst", "\n|\n", "blankLine"],
  ] as const)("%s %j is %s", (language, marked, expected) => {
    const [text, pos] = at(marked);
    expect(deriveInsertContext(language, text, pos)).toBe(expected);
  });
});

describe("list items and table rows", () => {
  it("adds an item after the line with its indentation", () => {
    const [text, pos] = at("  \\item o|ne\n");
    expect(deriveListItem("latex", text, pos)).toEqual({ from: 11, to: 11, insert: "\n  \\item ", cursor: 20 });
    const [typst, typstPos] = at("  + o|ne");
    expect(deriveListItem("typst", typst, typstPos).insert).toBe("\n  + ");
  });

  it("adds a row with as many cells as the line, the cursor in its first cell", () => {
    const [text, pos] = at("  a & b \\& c & d \\\\|");
    const row = deriveTableRow(text, pos);
    expect(row.insert).toBe("\n   &  &  \\\\");
    expect(row.cursor).toBe(text.length + 3);
  });
});
