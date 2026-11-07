// Reads Markdown pipe tables into table nodes and writes them back: the exact source while the table still reads as it, aligned pipes once edited.
// CONTRACT: documents/contracts/qmd-items.md#format
import { Fragment, type Node } from "prosemirror-model";
import { qmdSchema } from "./qmdSchema.js";
import { parseInline, serializeInline } from "./qmdInline.js";
import type { ColumnAlign } from "./tableSchema.js";

/** The index after the closing `$` of inline math opened at `at`, as Pandoc reads `$…$`, or -1. */
function mathEnd(text: string, at: number): number {
  if (!/\S/.test(text[at + 1] ?? " ")) { return -1; }
  for (let i = at + 1; i < text.length; i++) {
    if (text[i] === "\\") { i++; continue; }
    if (text[i] === "$" && /\S/.test(text[i - 1]!) && !/\d/.test(text[i + 1] ?? "")) { return i + 1; }
  }
  return -1;
}

/** The index after the code span opened by the backtick run at `at`, or after the run when it never closes. */
function codeEnd(text: string, at: number): { end: number; closed: boolean } {
  let ticks = 0;
  while (text[at + ticks] === "`") { ticks++; }
  for (let i = at + ticks; i < text.length;) {
    if (text[i] !== "`") { i++; continue; }
    let run = 0;
    while (text[i + run] === "`") { run++; }
    if (run === ticks) { return { end: i + run, closed: true }; }
    i += run;
  }
  return { end: at + ticks, closed: false };
}

/**
 * The cell sources of one table line, without the optional outer pipes, or null when no pipe splits it. A pipe after a
 * backslash or inside a code span or inline math does not split.
 */
export function splitTableRow(line: string): string[] | null {
  if (!/^ {0,3}\S/.test(line)) { return null; }
  const text = line.trim();
  const cells: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length;) {
    const char = text[i];
    if (char === "\\") { i += 2; continue; }
    if (char === "`") { i = codeEnd(text, i).end; continue; }
    if (char === "$") {
      const end = text[i + 1] === "$" ? -1 : mathEnd(text, i);
      i = end === -1 ? i + 1 : end;
      continue;
    }
    if (char === "|") { cells.push(text.slice(start, i)); start = i + 1; }
    i++;
  }
  if (cells.length === 0) { return null; }
  cells.push(text.slice(start));
  if (text.startsWith("|")) { cells.shift(); }
  if (cells.length > 0 && cells.at(-1)!.trim() === "" && text.endsWith("|")) { cells.pop(); }
  return cells;
}

const SEPARATOR_CELL = /^(:?)-+(:?)$/;

function readAlign(cell: string): ColumnAlign | undefined {
  const match = SEPARATOR_CELL.exec(cell.trim());
  if (!match) { return undefined; }
  if (match[1] && match[2]) { return "center"; }
  return match[1] ? "left" : match[2] ? "right" : null;
}

/** The rows and column alignment of a pipe table written as `lines`, or null when they do not read cleanly as one. */
function readTableLines(lines: readonly string[]): { align: ColumnAlign[]; rows: string[][] } | null {
  if (lines.length < 2) { return null; }
  const header = splitTableRow(lines[0]!);
  const separator = splitTableRow(lines[1]!);
  if (!header || !separator || header.length === 0 || header.length !== separator.length) { return null; }
  const align = separator.map(readAlign);
  if (align.some((entry) => entry === undefined)) { return null; }
  const rows = [header];
  for (const line of lines.slice(2)) {
    const row = splitTableRow(line);
    if (!row || row.length > header.length) { return null; }
    rows.push([...row, ...Array<string>(header.length - row.length).fill("")]);
  }
  return { align: align as ColumnAlign[], rows };
}

/** The pipes a cell escapes in its text, unescaped; code and math keep theirs. */
function cellContent(source: string): Node[] {
  return parseInline(source.trim()).map((node) => {
    if (!node.isText || node.marks.some((mark) => mark.type.name === "code")) { return node; }
    const text = node.text!.replace(/\\([\\|])/g, (escape, char: string) => (char === "|" ? "|" : escape));
    return text === node.text ? node : qmdSchema.text(text, node.marks);
  });
}

/** The table node of `lines` (without line endings), or null when they are not a clean pipe table. */
export function buildTable(lines: readonly string[], gap: string | null): Node | null {
  const read = readTableLines(lines);
  if (!read) { return null; }
  const rows = read.rows.map((row, index) => {
    const type = index === 0 ? qmdSchema.nodes.table_header! : qmdSchema.nodes.table_cell!;
    return qmdSchema.nodes.table_row!.create(null, row.map((cell, column) => type.create({ align: read.align[column] }, cellContent(cell))));
  });
  const raw = lines.map((line) => line + "\n").join("");
  return qmdSchema.nodes.table!.createChecked({ align: read.align, raw, gap }, rows);
}

/** The source of a cell on one line: pipes in its text escaped, line breaks as spaces. */
function cellSource(cell: Node): string {
  const nodes: Node[] = [];
  cell.forEach((node) => {
    if (node.type.name === "hard_break") { nodes.push(qmdSchema.text(" ", node.marks)); return; }
    if (!node.isText || node.marks.some((mark) => mark.type.name === "code")) { nodes.push(node); return; }
    nodes.push(qmdSchema.text(node.text!.replace(/\n/g, " ").replace(/\|/g, "\\|"), node.marks));
  });
  return serializeInline(Fragment.from(nodes)).trim();
}

function pad(text: string, width: number, align: ColumnAlign): string {
  const space = width - text.length;
  if (align === "right") { return " ".repeat(space) + text; }
  if (align === "center") { return " ".repeat(Math.floor(space / 2)) + text + " ".repeat(Math.ceil(space / 2)); }
  return text + " ".repeat(space);
}

function separatorCell(align: ColumnAlign, width: number): string {
  if (align === "center") { return `:${"-".repeat(width)}:`; }
  if (align === "left") { return `:${"-".repeat(width + 1)}`; }
  if (align === "right") { return `${"-".repeat(width + 1)}:`; }
  return "-".repeat(width + 2);
}

const sameAlign = (a: readonly ColumnAlign[], b: readonly ColumnAlign[]) => a.length === b.length && a.every((entry, index) => entry === b[index]);

/** Returns the table's lines ended with "\n": its stored source while that still reads as the table, else rows with aligned pipes. */
export function serializeTable(table: Node): string {
  const raw = table.attrs.raw as string | null;
  const align = table.attrs.align as ColumnAlign[];
  if (raw !== null) {
    const again = buildTable(raw.replace(/\n$/, "").split("\n"), null);
    if (again && sameAlign(again.attrs.align as ColumnAlign[], align) && again.content.eq(table.content)) { return raw; }
  }
  const rows: string[][] = [];
  table.forEach((row) => {
    const cells: string[] = [];
    row.forEach((cell) => cells.push(cellSource(cell)));
    rows.push(cells);
  });
  const columns = Math.max(align.length, ...rows.map((row) => row.length));
  const widths = Array.from({ length: columns }, (_, column) => Math.max(3, ...rows.map((row) => row[column]?.length ?? 0)));
  const columnAlign = (column: number): ColumnAlign => align[column] ?? null;
  const line = (row: string[]) => `| ${widths.map((width, column) => pad(row[column] ?? "", width, columnAlign(column))).join(" | ")} |\n`;
  const separator = `|${widths.map((width, column) => separatorCell(columnAlign(column), width)).join("|")}|\n`;
  const [header = [], ...body] = rows;
  return line(header) + separator + body.map(line).join("");
}
