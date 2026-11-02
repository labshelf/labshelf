// Chart table helpers (plan charts, D4): spreadsheet column letters and the rule that keeps a table inline in the chart block or moves it to assets/<id>.csv.
import { formatCsv } from "./csv.js";
import type { ChartModel, ChartTable } from "./model.js";

/** A chart whose JSON reaches this many UTF-8 bytes with its table inline keeps the table in a CSV instead. */
const INLINE_LIMIT = 65536;

/** The spreadsheet letter of a column index: 0 is A, 25 is Z, 26 is AA. */
export function columnLetter(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** Places a table in a model: inline as `data` when the model JSON stays under 65536 UTF-8 bytes, else as `src` = assets/<id>.csv with the CSV text for the caller to write. */
export function placeTable(model: ChartModel, table: ChartTable): { model: ChartModel; csv: { path: string; text: string } | null } {
  const { data: _data, src: _src, ...rest } = model;
  const inline: ChartModel = { ...rest, data: table };
  if (new TextEncoder().encode(JSON.stringify(inline)).length < INLINE_LIMIT) { return { model: inline, csv: null }; }
  const path = `assets/${model.id}.csv`;
  return { model: { ...rest, src: path }, csv: { path, text: formatCsv(table) } };
}
