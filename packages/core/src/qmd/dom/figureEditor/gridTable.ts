// The pure table side of the chart data grid: grid cells read and written on a chart table (row 0 is the column name, row r
// is data row r - 1), the structural edits of the toolbar and the rows of pasted text. DOM-free.
import { columnLetter, parseCsv, type ChartTable } from "../../chart/index.js";

export type Cell = number | string | null;
export interface Pos { row: number; col: number }

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/** A typed cell value: empty text is null, a number reads as a number, anything else stays text. */
export function readCell(text: string): Cell {
  const t = text.trim();
  if (t === "") return null;
  return NUMBER.test(t) ? Number(t) : text;
}

export function showCell(value: Cell): string {
  return value === null ? "" : String(value);
}

export function heightOf(table: ChartTable): number {
  return table.cols.reduce((m, c) => Math.max(m, c.values.length), 0);
}

export function isEmptyTable(table: ChartTable): boolean {
  return table.cols.every((c) => c.name.trim() === "" && c.values.every((v) => v === null));
}

/** A mutable copy with every column padded to the same height. */
export function cloneTable(table: ChartTable): ChartTable {
  const height = heightOf(table);
  return { cols: table.cols.map((c) => ({ name: c.name, values: Array.from({ length: height }, (_, r) => c.values[r] ?? null) })) };
}

/** The value a grid cell shows: row 0 is the column name, row r is data row r - 1. */
export function valueAt(table: ChartTable, pos: Pos): Cell {
  const col = table.cols[pos.col];
  if (col === undefined) return null;
  if (pos.row === 0) return col.name === "" ? null : col.name;
  return col.values[pos.row - 1] ?? null;
}

/** Writes one grid cell into a mutable table, growing it with blank columns and rows to reach the cell. */
export function writeCell(table: ChartTable, pos: Pos, value: Cell): void {
  while (table.cols.length <= pos.col) table.cols.push({ name: columnLetter(table.cols.length), values: [] });
  const height = Math.max(heightOf(table), pos.row);
  for (const c of table.cols) while (c.values.length < height) c.values.push(null);
  const col = table.cols[pos.col]!;
  if (pos.row === 0) col.name = value === null ? "" : String(value);
  else col.values[pos.row - 1] = value;
}

/** The rows of pasted text as cells; a header row parseCsv recognised comes back as the first row. */
export function pastedRows(text: string): Cell[][] {
  const { table, header } = parseCsv(text);
  const rows: Cell[][] = header ? [table.cols.map((c) => c.name)] : [];
  const height = heightOf(table);
  for (let r = 0; r < height; r += 1) rows.push(table.cols.map((c) => c.values[r] ?? null));
  return rows;
}

export const posKey = (pos: Pos): string => `${pos.row}:${pos.col}`;

/** The structural edits of the toolbar on a mutable table at the selected cell; false when nothing changes. */
export const EDITS: Readonly<Record<string, (table: ChartTable, sel: Pos) => boolean>> = {
  "Add row": (table, sel) => {
    if (table.cols.length === 0) return false;
    const at = Math.min(sel.row, heightOf(table));
    for (const c of table.cols) c.values.splice(at, 0, null);
    return true;
  },
  "Delete row": (table, sel) => {
    const at = sel.row - 1;
    if (at < 0 || at >= heightOf(table)) return false;
    for (const c of table.cols) c.values.splice(at, 1);
    return true;
  },
  "Add column": (table, sel) => {
    const at = Math.min(sel.col + 1, table.cols.length);
    table.cols.splice(at, 0, { name: columnLetter(at), values: Array.from({ length: heightOf(table) }, () => null) });
    return true;
  },
  "Delete column": (table, sel) => {
    if (sel.col >= table.cols.length) return false;
    table.cols.splice(sel.col, 1);
    return true;
  },
};

export const BUTTON_TEXT: Readonly<Record<string, string>> = { "Add row": "+ Row", "Delete row": "− Row", "Add column": "+ Column", "Delete column": "− Column" };
