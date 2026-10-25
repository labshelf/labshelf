// Builds an empty table as a snippet whose tab stops walk the cells, then the caption and label.
import { escapeSnippetText } from "./escapeSnippetText.js";

export interface TableSize {
  columns: number;
  rows: number;
}

export const MAX_TABLE_SIDE = 20;

/** Reads "3x2" (columns x rows; "×" and spaces allowed); undefined when it is not a size within the limit. */
export function parseTableSize(input: string): TableSize | undefined {
  const match = /^\s*(\d+)\s*[x×]\s*(\d+)\s*$/i.exec(input);
  if (!match) { return undefined; }
  const columns = Number(match[1]);
  const rows = Number(match[2]);
  const fits = (side: number): boolean => side >= 1 && side <= MAX_TABLE_SIDE;
  return fits(columns) && fits(rows) ? { columns, rows } : undefined;
}

function cellRows({ columns, rows }: TableSize): number[][] {
  return Array.from({ length: rows }, (_, row) => Array.from({ length: columns }, (_, column) => row * columns + column + 1));
}

export function createTableSnippet(language: "latex" | "typst", size: TableSize): string {
  const caption = size.columns * size.rows + 1;
  const cells = cellRows(size);
  if (language === "typst") {
    return [
      "#figure(",
      "\ttable(",
      `\t\tcolumns: ${size.columns},`,
      ...cells.map((row) => `\t\t${row.map((stop) => `[\${${stop}}]`).join(", ")},`),
      "\t),",
      `\tcaption: [\${${caption}:Caption}],`,
      `) <tab:\${${caption + 1}:label}>`,
      "$0",
    ].join("\n");
  }
  const rule = escapeSnippetText("\\hline");
  return [
    escapeSnippetText("\\begin{table}[h]"),
    `\t${escapeSnippetText("\\centering")}`,
    `\t${escapeSnippetText(`\\begin{tabular}{|${"c|".repeat(size.columns)}}`)}`,
    `\t\t${rule}`,
    ...cells.flatMap((row) => [`\t\t${row.map((stop) => `\${${stop}}`).join(" & ")} ${escapeSnippetText("\\\\")}`, `\t\t${rule}`]),
    `\t${escapeSnippetText("\\end{tabular}")}`,
    `\t${escapeSnippetText("\\caption{")}\${${caption}:Caption}${escapeSnippetText("}")}`,
    `\t${escapeSnippetText("\\label{tab:")}\${${caption + 1}:label}${escapeSnippetText("}")}`,
    escapeSnippetText("\\end{table}"),
    "$0",
  ].join("\n");
}
