// Reads a table from the PDF text inside its region, and writes and reads the pipe tables a note holds.
// CONTRACT: documents/contracts/qmd-items.md#format
import { splitTableRow, tableCodeEnd, tableMathEnd } from "../qmd/editor/index.js";
import type { PdfRegion } from "../reader/geometry.js";
import type { TextItemBox } from "../reader/textLines.js";

interface Segment { text: string; x0: number; x1: number }
interface Row { y: number; height: number; segments: Segment[] }

// A caption line ("Table 2.", "Tab. 3:", "Tabela 1 –") opens the region; its wrapped lines follow it as prose.
const CAPTION_START = /^\s*Tab(?:le|ela|la)?s?\s*\.?\s*\d/i;
// Words in one cell are closer than this many text heights; cells are further apart.
const WORD_GAP = 0.6;
// A column gap is at least this many text heights wide.
const MIN_COLUMN_GAP = 0.5;
// The share of rows that may cross a column gap: a header spanning two columns does not erase the gap under it.
const SPANNING_ROWS = 0.2;
const MIN_FILL = 0.6;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? 0;
}

function insideRegion(it: TextItemBox, region: PdfRegion): boolean {
  const centre = it.x + it.width / 2;
  return centre >= region.x0 && centre <= region.x1 && it.y >= region.yBottom && it.y <= region.yTop;
}

function clusterRows(items: readonly TextItemBox[], tolerance: number): TextItemBox[][] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: TextItemBox[][] = [];
  for (const it of sorted) {
    const row = rows.at(-1);
    if (row && Math.abs(row[0]!.y - it.y) <= tolerance) { row.push(it); } else { rows.push([it]); }
  }
  return rows;
}

function toSegments(items: readonly TextItemBox[], height: number): Segment[] {
  const parts = [...items].sort((a, b) => a.x - b.x);
  const segments: Segment[] = [];
  for (const it of parts) {
    const last = segments.at(-1);
    const text = it.str.replace(/\s+/g, " ");
    if (last && it.x - last.x1 <= height * WORD_GAP) {
      const space = it.x - last.x1 > height * 0.15 && !last.text.endsWith(" ") && !text.startsWith(" ");
      last.text += (space ? " " : "") + text;
      last.x1 = Math.max(last.x1, it.x + it.width);
    } else {
      segments.push({ text, x0: it.x, x1: it.x + it.width });
    }
  }
  return segments.map((s) => ({ ...s, text: s.text.trim() })).filter((s) => s.text !== "");
}

// Drops the caption's first line and the prose lines that continue it (one segment each, at line pitch).
function dropCaption(rows: Row[]): Row[] {
  let at = 0;
  if (rows[0] && CAPTION_START.test(rows[0].segments.map((s) => s.text).join(" "))) {
    at = 1;
    while (rows[at] && rows[at]!.segments.length === 1 && rows[at - 1]!.y - rows[at]!.y <= Math.max(rows[at]!.height, rows[at - 1]!.height) * 1.7) { at++; }
  }
  return rows.slice(at);
}

// The x ranges between columns: stretches no more than a few rows cover, at least MIN_COLUMN_GAP heights wide.
function columnGaps(rows: readonly Row[], x0: number, x1: number, height: number): Array<[number, number]> {
  const step = Math.max(height / 8, 0.25);
  const bins = Math.max(1, Math.ceil((x1 - x0) / step));
  const cover = new Array<number>(bins).fill(0);
  for (const row of rows) {
    const seen = new Set<number>();
    for (const s of row.segments) {
      const from = Math.max(0, Math.floor((s.x0 - x0) / step));
      const to = Math.min(bins - 1, Math.floor((s.x1 - x0) / step));
      for (let b = from; b <= to; b++) { seen.add(b); }
    }
    for (const b of seen) { cover[b]! += 1; }
  }
  const allowed = Math.floor(rows.length * SPANNING_ROWS);
  const gaps: Array<[number, number]> = [];
  let start = -1;
  for (let b = 0; b <= bins; b++) {
    const open = b < bins && cover[b]! <= allowed;
    if (open && start < 0) { start = b; }
    if (!open && start >= 0) {
      const from = x0 + start * step;
      const to = x0 + b * step;
      if (start > 0 && b < bins && to - from >= height * MIN_COLUMN_GAP) { gaps.push([from, to]); }
      start = -1;
    }
  }
  return gaps;
}

function filled(row: readonly string[]): number {
  return row.filter((c) => c !== "").length;
}

// A header set on two lines: the line with an empty first cell that does not fill the row joins the other.
function mergeHeader(table: string[][]): string[][] {
  const [first, second] = table;
  if (!first || !second || table.length < 3) { return table; }
  const partial = (row: readonly string[]): boolean => row[0] === "" && filled(row) < row.length;
  if (!partial(first) && !partial(second)) { return table; }
  const header = first.map((cell, i) => [cell, second[i] ?? ""].filter((c) => c !== "").join(" "));
  return [header, ...table.slice(2)];
}

/**
 * Rebuilds a table from the PDF text items inside its region, caption left out: rows by baseline, columns by the
 * vertical gaps the rows share.
 * @returns the cells row by row, header first, or null unless at least 2 rows and 2 columns are found and most rows
 *          fill most columns.
 */
export function tableFromTextItems(items: readonly TextItemBox[], region: PdfRegion): string[][] | null {
  const inside = items.filter((it) => (it.orientation ?? 0) === 0 && it.str.trim() !== "" && insideRegion(it, region));
  if (inside.length < 4) { return null; }
  const height = median(inside.map((it) => it.height)) || 10;
  const rows = dropCaption(clusterRows(inside, height * 0.5).map((row) => ({
    y: row[0]!.y,
    height: Math.max(...row.map((it) => it.height)),
    segments: toSegments(row, height),
  })).filter((row) => row.segments.length > 0));
  if (rows.length < 2) { return null; }
  const x0 = Math.min(...rows.flatMap((r) => r.segments.map((s) => s.x0)));
  const x1 = Math.max(...rows.flatMap((r) => r.segments.map((s) => s.x1)));
  const gaps = columnGaps(rows, x0, x1, height);
  const columns = gaps.length + 1;
  if (columns < 2) { return null; }
  const table = rows.map((row) => {
    const cells = new Array<string>(columns).fill("");
    for (const s of row.segments) {
      const column = gaps.filter(([from]) => s.x0 >= from).length;
      cells[column] = cells[column] === "" ? s.text : `${cells[column]} ${s.text}`;
    }
    return cells;
  });
  const merged = mergeHeader(table);
  const full = merged.filter((row) => filled(row) >= Math.ceil(columns * MIN_FILL)).length;
  if (merged.length < 2 || full < merged.length * MIN_FILL) { return null; }
  return merged;
}

// Escapes `|` in text only: inside inline math and code spans it does not split a cell and must stay as written.
function escapeCell(cell: string): string {
  const text = cell.replace(/\s+/g, " ").trim();
  let out = "";
  for (let i = 0; i < text.length;) {
    const char = text[i]!;
    if (char === "\\") { out += text.slice(i, i + 2); i += 2; continue; }
    // The note's table reader does not split inside these: math from `$` (never `$$`) and code spans.
    const end = char === "`" ? tableCodeEnd(text, i).end : char === "$" && text[i + 1] !== "$" ? tableMathEnd(text, i) : -1;
    if (end > i + 1) { out += text.slice(i, end); i = end; continue; }
    out += char === "|" ? "\\|" : char;
    i++;
  }
  return out;
}

/**
 * Writes rows as a pipe table that the note editor reads as a table: the first row is the header, then a `---`
 * separator, every row padded to the widest row, `|` escaped as `\|` outside math and code, no caption line.
 */
export function formatPipeTable(rows: readonly (readonly string[])[]): string {
  const columns = Math.max(1, ...rows.map((r) => r.length));
  const cells = rows.map((row) => Array.from({ length: columns }, (_, i) => escapeCell(row[i] ?? "")));
  const widths = Array.from({ length: columns }, (_, i) => Math.max(3, ...cells.map((row) => row[i]!.length)));
  const line = (row: readonly string[]): string => `| ${row.map((cell, i) => cell.padEnd(widths[i]!)).join(" | ")} |`;
  const [header = [], ...body] = cells;
  return [line(header), line(widths.map((w) => "-".repeat(w))), ...body.map(line)].join("\n");
}

function splitRow(line: string): string[] | null {
  return splitTableRow(line)?.map((c) => c.trim().replace(/\\\|/g, "|")) ?? null;
}

const SEPARATOR_CELL = /^:?-+:?$/;

/**
 * Reads a pipe table as the note editor does: header row, separator row of dashes (with optional colons), body rows up
 * to the end; `\|` is unescaped in the cells.
 * @returns the rows, header first, or null when the text is not exactly one clean table.
 */
export function parsePipeTable(text: string): string[][] | null {
  const lines = text.trim().split(/\r?\n/);
  const [headLine, sepLine, ...bodyLines] = lines;
  if (headLine === undefined || sepLine === undefined) { return null; }
  const header = splitRow(headLine);
  const separator = splitRow(sepLine);
  if (!header || !separator || separator.length !== header.length || !separator.every((c) => SEPARATOR_CELL.test(c))) { return null; }
  const rows: string[][] = [header];
  for (const line of bodyLines) {
    const row = splitRow(line);
    if (!row || row.length > header.length) { return null; }
    rows.push([...row, ...new Array<string>(header.length - row.length).fill("")]);
  }
  return rows;
}
