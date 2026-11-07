/**
 * Tests that pipe tables read as table nodes, write back byte for byte while untouched, re-emit with aligned pipes once
 * edited, escape pipes only in text, and that lines that do not read cleanly as a table stay as they were.
 */
import type { Node as PmNode } from "prosemirror-model";
import { Transform } from "prosemirror-transform";
import { bodyToDoc, docToBody } from "../../../src/qmd/editor/qmdDoc";
import { qmdSchema as s } from "../../../src/qmd/editor/qmdSchema";
import { splitTableRow } from "../../../src/qmd/editor/qmdTable";

const REPRO = [
  "Tabela Markdown simples:",
  "",
  "| Primo $p$ | $p \\bmod 4$ | Soma de dois quadrados? |",
  "|----------:|:-----------:|:------------------------|",
  "| 2         | 2           | sim, $1^2 + 1^2$        |",
  "| 5         | 1           | sim, $1^2 + 2^2$        |",
  "| 7         | 3           | não                     |",
  "| 13        | 1           | sim, $2^2 + 3^2$        |",
  "",
].join("\n");

const types = (doc: PmNode) => {
  const names: string[] = [];
  doc.forEach((node) => names.push(node.type.name));
  return names;
};

const tableOf = (doc: PmNode): PmNode => {
  let table: PmNode | undefined;
  doc.forEach((node) => { if (node.type.name === "table") table = node; });
  if (!table) throw new Error("no table");
  return table;
};

const cellTexts = (table: PmNode) => {
  const rows: string[][] = [];
  table.forEach((row) => {
    const cells: string[] = [];
    row.forEach((cell) => cells.push(cell.textContent));
    rows.push(cells);
  });
  return rows;
};

/** The document with the text of the cell at `row`, `column` replaced by `text`. */
function editCell(doc: PmNode, row: number, column: number, text: string): PmNode {
  let pos = -1;
  doc.forEach((node, offset) => { if (node.type.name === "table") pos = offset; });
  const table = doc.nodeAt(pos)!;
  pos += 1;
  for (let r = 0; r < row; r++) pos += table.child(r).nodeSize;
  pos += 1;
  for (let c = 0; c < column; c++) pos += table.child(row).child(c).nodeSize;
  const cell = table.child(row).child(column);
  return new Transform(doc).replaceWith(pos + 1, pos + cell.nodeSize - 1, text ? s.text(text) : []).doc;
}

describe("pipe tables", () => {
  it("reads the repro table as a table with column alignment and inline math", () => {
    const doc = bodyToDoc(REPRO);
    expect(types(doc)).toEqual(["paragraph", "table"]);
    const table = tableOf(doc);
    expect(table.attrs.align).toEqual(["right", "center", "left"]);
    expect(table.child(0).child(0).type.name).toBe("table_header");
    expect(table.child(1).child(0).type.name).toBe("table_cell");
    expect(table.child(1).child(2).attrs.align).toBe("left");
    expect(table.child(0).child(1).firstChild!.type.name).toBe("math_inline");
    expect(table.child(0).child(1).firstChild!.attrs.tex).toBe("p \\bmod 4");
    expect(cellTexts(table)[4]).toEqual(["13", "1", "sim, 2^2 + 3^2"]);
  });

  it.each([
    ["repro", REPRO],
    ["no outer pipes", "a | b\n--|:-:\n1 | 2\n"],
    ["escaped pipe", "| a | b |\n|---|---|\n| x \\| y | z |\n"],
    ["code with a pipe", "| op | meaning |\n| --- | --- |\n| `a | b` | or |\n"],
    ["math with pipes", "| x | norm |\n|---|---|\n| 1 | $|x|$ |\n"],
    ["short row", "| a | b |\n|---|---|\n| 1 |\n"],
    ["CRLF", "| a | b |\r\n|---|---|\r\n| 1 | 2 |\r\n"],
    ["between paragraphs", "before\n\n| a |\n|:--|\n\nafter\n"],
    ["in a list item", "- item\n\n  | a | b |\n  |---|---|\n  | 1 | 2 |\n"],
  ])("writes an untouched table back byte for byte: %s", (_name, body) => {
    const doc = bodyToDoc(body);
    expect(docToBody(doc)).toBe(body);
  });

  it("reads the variants as tables", () => {
    expect(types(bodyToDoc("a | b\n--|:-:\n1 | 2\n"))).toEqual(["table"]);
    const escaped = tableOf(bodyToDoc("| a | b |\n|---|---|\n| x \\| y | z |\n"));
    expect(cellTexts(escaped)[1]).toEqual(["x | y", "z"]);
    const code = tableOf(bodyToDoc("| op | meaning |\n| --- | --- |\n| `a | b` | or |\n"));
    expect(cellTexts(code)[1]).toEqual(["a | b", "or"]);
    expect(code.child(1).child(0).firstChild!.marks[0]!.type.name).toBe("code");
    const math = tableOf(bodyToDoc("| x | norm |\n|---|---|\n| 1 | $|x|$ |\n"));
    expect(math.child(1).child(1).firstChild!.attrs.tex).toBe("|x|");
    expect(cellTexts(tableOf(bodyToDoc("| a | b |\n|---|---|\n| 1 |\n")))[1]).toEqual(["1", ""]);
  });

  it("re-emits an edited table with aligned pipes and its alignment row", () => {
    const doc = editCell(bodyToDoc(REPRO), 3, 2, "no");
    expect(docToBody(doc)).toBe([
      "Tabela Markdown simples:",
      "",
      "| Primo $p$ | $p \\bmod 4$ | Soma de dois quadrados? |",
      "|----------:|:-----------:|:------------------------|",
      "|         2 |      2      | sim, $1^2 + 1^2$        |",
      "|         5 |      1      | sim, $1^2 + 2^2$        |",
      "|         7 |      3      | no                      |",
      "|        13 |      1      | sim, $2^2 + 3^2$        |",
      "",
    ].join("\n"));
  });

  it("escapes pipes in text only, not in code or math, when it re-emits", () => {
    const doc = editCell(bodyToDoc("| op | m |\n|---|---|\n| `a | b` | $|x|$ |\n"), 0, 1, "a|b");
    expect(docToBody(doc)).toBe("| op      | a\\|b  |\n|---------|-------|\n| `a | b` | $|x|$ |\n");
    expect(docToBody(bodyToDoc(docToBody(doc)))).toBe(docToBody(doc));
  });

  it("writes an editor-built table canonically", () => {
    const cell = (type: "table_header" | "table_cell", text: string) => s.node(type, null, text ? [s.text(text)] : []);
    const table = s.node("table", { align: [null, null] }, [
      s.node("table_row", null, [cell("table_header", ""), cell("table_header", "")]),
      s.node("table_row", null, [cell("table_cell", ""), cell("table_cell", "")]),
    ]);
    expect(docToBody(s.node("doc", null, [table]))).toBe("|     |     |\n|-----|-----|\n|     |     |\n");
  });

  it.each([
    ["no separator", "| a | b |\n| c | d |\n"],
    ["column count mismatch", "| a | b |\n|---|\n"],
    ["bad separator", "| a | b |\n|---|-x-|\n"],
    ["a row with too many cells", "| a | b |\n|---|---|\n| 1 | 2 | 3 |\n"],
    ["a row without a pipe", "| a | b |\n|---|---|\nplain line\n"],
    ["a caption line", "| a |\n|---|\n: Caption\n"],
  ])("keeps a malformed table as it was: %s", (_name, body) => {
    const doc = bodyToDoc(body);
    expect(types(doc)).not.toContain("table");
    expect(docToBody(doc)).toBe(body);
  });

  it("splits rows on pipes outside escapes, code and math", () => {
    expect(splitTableRow("| a | b |")).toEqual([" a ", " b "]);
    expect(splitTableRow("a | b")).toEqual(["a ", " b"]);
    expect(splitTableRow("| a \\| b | `c|d` | $|x|$ |")).toEqual([" a \\| b ", " `c|d` ", " $|x|$ "]);
    expect(splitTableRow("no pipes")).toBeNull();
  });
});
