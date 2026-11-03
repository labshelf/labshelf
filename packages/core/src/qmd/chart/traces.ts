// The Plotly traces of a data chart: one per chart trace, read from the chart's table by column letter and coloured from the page palette. Text cells in numeric columns become null gaps. DOM-free.
import type { ChartTable, ChartTrace } from "./model.js";

type Cell = number | string | null;
type Column = Cell[];
type Numbers = (number | null)[];

/** The index of a spreadsheet column letter (A is 0, Z is 25, AA is 26); -1 for anything else. */
function columnIndex(letter: string): number {
  if (!/^[A-Z]+$/.test(letter)) return -1;
  let index = 0;
  for (const char of letter) index = index * 26 + (char.charCodeAt(0) - 64);
  return index - 1;
}

/** The cells of the column with this letter; empty for an absent letter or a column the table lacks. */
function columnOf(table: ChartTable, letter: string | undefined): Column {
  if (letter === undefined) return [];
  return [...(table.cols[columnIndex(letter)]?.values ?? [])];
}

/** The cells as numbers, with text and empty cells as null gaps. */
function numbers(cells: Column): Numbers {
  return cells.map((cell) => (typeof cell === "number" ? cell : null));
}

/** The fields every trace shares: its name, opacity and legend entry when the model sets them. */
function common(trace: ChartTrace): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (trace.name !== undefined) out.name = trace.name;
  if (trace.opacity !== undefined) out.opacity = trace.opacity;
  if (trace.showlegend !== undefined) out.showlegend = trace.showlegend;
  return out;
}

function lineOf(color: string, width: number | undefined): Record<string, unknown> {
  return width === undefined ? { color } : { color, width };
}

function markerOf(color: string, size: number | undefined): Record<string, unknown> {
  return size === undefined ? { color } : { color, size };
}

/** The z matrix of a heatmap, contour or surface: rows by Z columns, or its transpose. */
function matrix(table: ChartTable, letters: string[], transpose: boolean): Numbers[] {
  const cols = letters.map((letter) => numbers(columnOf(table, letter)));
  const rows = Math.max(0, ...cols.map((col) => col.length));
  const byRow: Numbers[] = Array.from({ length: rows }, (_, i) => cols.map((col) => col[i] ?? null));
  if (!transpose) return byRow;
  return cols.map((_, j) => byRow.map((row) => row[j] ?? null));
}

function surfaceLike(trace: ChartTrace, table: ChartTable, base: Record<string, unknown>): Record<string, unknown> {
  const z = matrix(table, trace.z ?? [], trace.transpose === true);
  const rows = Math.max(0, ...(trace.z ?? []).map((letter) => columnOf(table, letter).length));
  const out: Record<string, unknown> = { type: trace.type, ...base };
  if (trace.x !== undefined) out.x = numbers(columnOf(table, trace.x));
  out.y = trace.y !== undefined ? numbers(columnOf(table, trace.y)) : Array.from({ length: rows }, (_, i) => i);
  out.z = z;
  out.colorscale = trace.colorscale ?? "Viridis";
  out.showscale = true;
  return out;
}

type Out = Record<string, unknown>;

function scatterTrace(trace: ChartTrace, table: ChartTable, base: Out, color: string): Out {
  const out: Out = {
    type: "scatter",
    ...base,
    x: numbers(columnOf(table, trace.x)),
    y: numbers(columnOf(table, trace.y)),
    mode: trace.mode ?? "lines",
    line: lineOf(color, trace.lineWidth),
    marker: markerOf(color, trace.markerSize),
  };
  if (trace.fill !== undefined) out.fill = trace.fill;
  return out;
}

function barTrace(trace: ChartTrace, table: ChartTable, base: Out, color: string): Out {
  const x = columnOf(table, trace.x);
  const y = numbers(columnOf(table, trace.y));
  return { type: "bar", ...base, ...(trace.orientation === "h" ? { orientation: "h", x: y, y: x } : { x, y }), marker: { color } };
}

function pieTrace(trace: ChartTrace, table: ChartTable, base: Out, color: string, palette: readonly string[]): Out {
  const labels = columnOf(table, trace.x);
  const out: Out = {
    type: "pie",
    ...base,
    labels,
    values: numbers(columnOf(table, trace.y)),
    marker: { colors: labels.map((_, i) => palette[i % palette.length] ?? color) },
    sort: false,
  };
  if (trace.hole !== undefined) out.hole = trace.hole;
  return out;
}

function scatter3dTrace(trace: ChartTrace, table: ChartTable, base: Out, color: string): Out {
  return {
    type: "scatter3d",
    ...base,
    x: numbers(columnOf(table, trace.x)),
    y: numbers(columnOf(table, trace.y)),
    z: numbers(columnOf(table, trace.z?.[0])),
    mode: trace.mode ?? "markers",
    marker: markerOf(color, trace.markerSize),
    line: lineOf(color, trace.lineWidth),
  };
}

function mesh3dTrace(trace: ChartTrace, table: ChartTable, base: Out, color: string): Out {
  return {
    type: "mesh3d",
    ...base,
    x: numbers(columnOf(table, trace.x)),
    y: numbers(columnOf(table, trace.y)),
    z: numbers(columnOf(table, trace.z?.[0])),
    color,
  };
}

function boxTrace(trace: ChartTrace, table: ChartTable, base: Out, color: string): Out {
  const out: Out = { type: "box", ...base, y: numbers(columnOf(table, trace.y)) };
  if (trace.x !== undefined) out.x = columnOf(table, trace.x);
  out.marker = { color };
  return out;
}

/**
 * The Plotly traces one chart trace draws, coloured with its own colour or the palette colour of its index. Scatter (lines, markers, area fill), bar (vertical or horizontal), pie, heatmap, contour, surface, scatter3d, mesh3d, histogram and box each give one.
 * A heatmap, contour or surface without a colourscale draws Viridis; the caller puts the layout's colourscale on the trace first.
 */
export function traceData(trace: ChartTrace, table: ChartTable, palette: readonly string[], index: number): Record<string, unknown>[] {
  const color = trace.color ?? palette[index % palette.length] ?? "#808080";
  const base = common(trace);
  switch (trace.type) {
    case "scatter":
      return [scatterTrace(trace, table, base, color)];
    case "bar":
      return [barTrace(trace, table, base, color)];
    case "pie":
      return [pieTrace(trace, table, base, color, palette)];
    case "heatmap":
    case "contour":
    case "surface":
      return [surfaceLike(trace, table, base)];
    case "scatter3d":
      return [scatter3dTrace(trace, table, base, color)];
    case "mesh3d":
      return [mesh3dTrace(trace, table, base, color)];
    case "histogram":
      return [{ type: "histogram", ...base, x: numbers(columnOf(table, trace.x)), marker: { color } }];
    case "box":
      return [boxTrace(trace, table, base, color)];
  }
}
