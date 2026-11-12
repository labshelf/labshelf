/** A linked table: read from CSV, TSV or JSON, its numbers rounded, rendered as a booktabs `tabular` or a Typst `table`, and read back from that copy for a preview. */
// CONTRACT: documents/contracts/library-format.md#linked-outputs
import { extensionOf } from "../../path/index.js";
import { escapeLatex } from "../project/index.js";
import type { OutputFormat } from "./outputsFile.js";

export const MAX_TABLE_ROWS = 2000;
export const MAX_TABLE_COLUMNS = 64;

/** A cell as read: JSON numbers stay numbers, everything else is text. */
type Cell = string | number;

/** The header row first, then the body rows, each as long as the widest row. */
export interface OutputTable { header: string[]; rows: Cell[][] }

const PLAIN_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const WHOLE_NUMBER = /^[+-]?\d+$/;
const SCIENTIFIC = /[eE]/;

/** Splits RFC 4180 text: quoted fields may hold the delimiter, line breaks and doubled quotes. Blank lines are dropped. */
function splitDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let at = 0;
  const endRow = (): void => {
    row.push(field);
    if (row.length > 1 || row[0] !== "") { rows.push(row); }
    row = [];
    field = "";
  };
  while (at < text.length) {
    const character = text[at]!;
    if (quoted) {
      if (character === '"' && text[at + 1] === '"') { field += '"'; at += 2; continue; }
      if (character === '"') { quoted = false; } else { field += character; }
    } else if (character === '"' && field === "") { quoted = true; }
    else if (character === delimiter) { row.push(field); field = ""; }
    else if (character === "\n" || character === "\r") { if (character === "\r" && text[at + 1] === "\n") { at++; } endRow(); }
    else { field += character; }
    at++;
  }
  if (field !== "" || row.length > 0) { endRow(); }
  return rows;
}

/** Tab when the first line has one, else `;` when it has more of them than `,`, else `,`. */
export function detectDelimiter(text: string): string {
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  if (first.includes("\t")) { return "\t"; }
  const count = (character: string): number => first.split(character).length - 1;
  return count(";") > count(",") ? ";" : ",";
}

function fromJson(json: unknown): Cell[][] {
  const cell = (value: unknown): Cell => typeof value === "number" ? value : value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value as string | boolean);
  if (Array.isArray(json) && json.every((item) => Array.isArray(item))) { return (json as unknown[][]).map((row) => row.map(cell)); }
  if (Array.isArray(json) && json.every((item) => item !== null && typeof item === "object" && !Array.isArray(item))) {
    const objects = json as Array<Record<string, unknown>>;
    const header: string[] = [];
    for (const object of objects) { for (const key of Object.keys(object)) { if (!header.includes(key)) { header.push(key); } } }
    return [header, ...objects.map((object) => header.map((key) => cell(object[key])))];
  }
  if (json !== null && typeof json === "object" && Array.isArray((json as { columns?: unknown }).columns) && Array.isArray((json as { rows?: unknown }).rows)) {
    const { columns, rows } = json as { columns: unknown[]; rows: unknown[] };
    return [columns.map(cell), ...rows.map((row) => Array.isArray(row) ? row.map(cell) : [cell(row)])];
  }
  throw new Error("A JSON table must be an array of objects, an array of arrays, or {columns, rows}.");
}

/** Reads a table file by its extension (`.json`, else delimited text); throws a sentence when it is not a table or is over the caps. */
export function parseOutputTable(path: string, text: string): OutputTable {
  const cells = extensionOf(path) === ".json" ? fromJson(JSON.parse(text)) : splitDelimited(text.replace(/^﻿/, ""), extensionOf(path) === ".tsv" ? "\t" : detectDelimiter(text));
  if (cells.length === 0) { throw new Error(`${path} holds no table.`); }
  const width = Math.max(...cells.map((row) => row.length));
  if (width > MAX_TABLE_COLUMNS) { throw new Error(`${path} has ${width} columns; LabShelf links tables of up to ${MAX_TABLE_COLUMNS} columns.`); }
  if (cells.length - 1 > MAX_TABLE_ROWS) { throw new Error(`${path} has ${cells.length - 1} rows; LabShelf links tables of up to ${MAX_TABLE_ROWS} rows.`); }
  const pad = (row: Cell[]): Cell[] => [...row, ...Array<Cell>(width - row.length).fill("")];
  return { header: pad(cells[0]!).map(String), rows: cells.slice(1).map(pad) };
}

const isNumberCell = (cell: Cell): boolean => typeof cell === "number" ? Number.isFinite(cell) : PLAIN_NUMBER.test(cell.trim());

/**
 * The cell as printed. With `decimals` set, a fraction is rounded to that many places, a number written in scientific notation keeps it
 * with that many places in the mantissa, and a whole number stays as written; without it, every cell is as written.
 */
function formatCell(cell: Cell, decimals: number | undefined): string {
  if (decimals === undefined || !isNumberCell(cell)) { return String(cell); }
  const written = typeof cell === "number" ? String(cell) : cell.trim();
  if (WHOLE_NUMBER.test(written)) { return written; }
  const value = Number(written);
  const rounded = SCIENTIFIC.test(written) ? value.toExponential(decimals) : value.toFixed(decimals);
  // Rounding a small negative to zero gives "-0.00", which no table means.
  return /^-0(?:\.0*)?(?:e[+-]?\d+)?$/.test(rounded) ? rounded.slice(1) : rounded;
}

/** The table as text cells, header first, with numbers rounded; a column is numeric when every non-empty body cell is a number. */
export function formatOutputTable(table: OutputTable, decimals: number | undefined): { rows: string[][]; numeric: boolean[] } {
  const numeric = table.header.map((_, column) => {
    const cells = table.rows.map((row) => row[column]!).filter((cell) => cell !== "");
    return cells.length > 0 && cells.every(isNumberCell);
  });
  return { rows: [table.header, ...table.rows.map((row) => row.map((cell) => formatCell(cell, decimals)))], numeric };
}

const escapeTypst = (text: string): string => text.replace(/[\\[\]#$*_@<`]/g, (character) => `\\${character}`).replace(/\r\n|\r|\n/g, " ");

/** The generated `.tex` or `.typ` file of a linked table. */
export function renderOutputTable(table: OutputTable, options: { source: string; path: string; decimals?: number }, format: OutputFormat): string {
  const { rows, numeric } = formatOutputTable(table, options.decimals);
  const [header, ...body] = rows as [string[], ...string[][]];
  if (format === "latex") {
    const line = (row: readonly string[]): string => `${row.map(escapeLatex).join(" & ")} \\\\`;
    return [
      `% Generated by LabShelf from ${options.source}:${options.path}. Edits are overwritten.`,
      `\\begin{tabular}{${numeric.map((isNumber) => isNumber ? "r" : "l").join("")}}`, "\\toprule", line(header), "\\midrule", ...body.map(line), "\\bottomrule", "\\end{tabular}",
    ].join("\n") + "\n";
  }
  const cells = (row: readonly string[]): string => row.map((cell) => `[${escapeTypst(cell)}]`).join(", ");
  return [
    `// Generated by LabShelf from ${options.source}:${options.path}. Edits are overwritten.`, "#table(", `  columns: ${header.length},`,
    `  align: (${numeric.map((isNumber) => isNumber ? "right" : "left").join(", ")}${numeric.length === 1 ? "," : ""}),`,
    `  table.header(${cells(header)}),`, ...body.map((row) => `  ${cells(row)},`), ")",
  ].join("\n") + "\n";
}

const unescapeLatex = (text: string): string =>
  text.replace(/\\textbackslash\{\}/g, "\\").replace(/\\textasciitilde\{\}/g, "~").replace(/\\textasciicircum\{\}/g, "^").replace(/\\([{}$&#_%])/g, "$1").trim();

/** Splits on the `&` that are not escaped. */
const splitLatexRow = (line: string): string[] => line.split(/(?<!\\)&/).map(unescapeLatex);

/** Splits `[a], [b\]]` into its unescaped cell texts. */
function splitTypstRow(line: string): string[] {
  return [...line.matchAll(/\[((?:\\.|[^\]\\])*)\]/g)].map((match) => match[1]!.replace(/\\(.)/g, "$1"));
}

/** The rows of a copy LabShelf generated, for a preview; an edited copy gives what can still be read. */
export function readOutputTableCopy(text: string, format: OutputFormat): string[][] {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  if (format === "latex" || lines.some((line) => line.startsWith("\\begin{tabular}"))) {
    return lines.filter((line) => line.endsWith("\\\\")).map((line) => splitLatexRow(line.slice(0, -2)));
  }
  return lines.flatMap((line) => {
    const inner = /^table\.header\((.*)\),?$/.exec(line)?.[1] ?? (line.startsWith("[") ? line : undefined);
    return inner === undefined ? [] : [splitTypstRow(inner)];
  });
}
