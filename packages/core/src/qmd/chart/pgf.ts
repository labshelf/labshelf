// The pgfplots picture of a chart (plan charts, D7): a tikzpicture holding one axis (a 3D axis for 3D charts) with an
// \addplot per visible function or trace, for the charts pgfplots can draw; null for the rest, which stay image-only.
// The text has no guard: formatChartBlock wraps it in the \pgfplotsset guard. DOM-free.
// CONTRACT: documents/contracts/qmd-items.md#charts
import { parseExpr, formatPgfExpr } from "../../drawing/index.js";
import { EXPORT_THEME, type ChartAxis, type ChartFn, type ChartModel, type ChartTable, type ChartTrace } from "./model.js";

type Cell = number | string | null;

/** The width of the picture, the same as the stored PNG's. */
const WIDTH_CM = 16;
/** The PNG export's size in pixels, the aspect when the layout sets none. */
const DEFAULT_PX = { width: 640, height: 400 };
/** A table with more rows than this is too large to write as coordinates. */
const MAX_ROWS = 2000;
const DEFAULT_SAMPLES_2D = 100;
const DEFAULT_SAMPLES_3D = 30;
const MAX_SAMPLES = 400;
const DEFAULT_VIEW: [number, number] = [-10, 10];
const DEFAULT_ANGLE: [number, number] = [0, 2 * Math.PI];
/** Plotly's default 3D camera eye. */
const DEFAULT_EYE = { x: 1.25, y: 1.25, z: 1.25 };
const FILL_OPACITY = 0.3;
/** Category names written as symbolic coordinates: plain ASCII text that is safe in a TeX control sequence name and as a tick label. */
const SYMBOL = /^[A-Za-z0-9][A-Za-z0-9 .+-]*$/;

class Unmappable extends Error {}

function unmappable(): never {
  throw new Unmappable();
}

/** A number in short decimal form: six significant digits, never -0. */
function num(value: number): string {
  if (!Number.isFinite(value)) { unmappable(); }
  const short = Number(value.toPrecision(6));
  return short === 0 ? "0" : String(short);
}

/** Text set in TeX text mode with its special characters escaped. */
function tex(text: string): string {
  return text.replace(/[\\{}$&#^_%~]/g, (c) => {
    if (c === "\\") { return "\\textbackslash{}"; }
    if (c === "^") { return "\\textasciicircum{}"; }
    if (c === "~") { return "\\textasciitilde{}"; }
    return `\\${c}`;
  }).replace(/[\r\n]+/g, " ");
}

/** A #rgb or #rrggbb colour as an xcolor rgb,255 expression; null for any other colour text. */
function rgb(colour: string): string | null {
  const hex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(colour.trim())?.[1];
  if (hex === undefined) { return null; }
  const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  return `{rgb,255:red,${r};green,${g};blue,${b}}`;
}

/** The colour of the item at `index`: its own when it is a hex colour, else the palette's. */
function colourOf(own: string | undefined, index: number): string {
  return (own !== undefined ? rgb(own) : null) ?? rgb(EXPORT_THEME.palette[index % EXPORT_THEME.palette.length]!)!;
}

function opts(list: readonly string[]): string {
  return list.length > 0 ? `[${list.join(", ")}]` : "";
}

function samplesOf(steps: number | undefined, fallback: number): number {
  return steps !== undefined && Number.isFinite(steps) && steps >= 1 ? Math.min(MAX_SAMPLES, Math.max(2, Math.round(steps))) : fallback;
}

function range(name: string, r: readonly [number, number]): string {
  return `${name}=${num(r[0])}:${num(r[1])}`;
}

/** The parts of a function printed in pgfmath syntax, with the chart's variables inlined; unmappable when one does not parse. */
function exprs(fn: ChartFn, count: number, own: readonly string[], model: ChartModel): string[] {
  const params = model.vars.map((v) => v.name).filter((name) => !own.includes(name));
  const env: Record<string, number> = {};
  for (const v of model.vars) { env[v.name] = v.value; }
  const out: string[] = [];
  for (let part = 0; part < count; part += 1) {
    const text = fn.expr[part];
    if (text === undefined) { unmappable(); }
    const parsed = parseExpr(text, { vars: own, params });
    if (!parsed.ok) { unmappable(); }
    out.push(formatPgfExpr(parsed.ast, env));
  }
  return out;
}

interface Plot { line: string; name: string | undefined }

function fn2dPlot(fn: ChartFn, index: number, model: ChartModel): Plot {
  if ((fn.rel ?? "=") !== "=") { unmappable(); }
  const colour = `color=${colourOf(fn.color, index)}`;
  const steps = Array.isArray(fn.steps) ? fn.steps[0] : fn.steps;
  const samples = `samples=${samplesOf(steps, DEFAULT_SAMPLES_2D)}`;
  const layout = model.layout;
  switch (fn.kind) {
    case "y": {
      const [f] = exprs(fn, 1, ["x"], model);
      const domain = range("domain", fn.domain ?? layout.xaxis.range ?? DEFAULT_VIEW);
      return { line: `\\addplot${opts([domain, samples, colour, "no markers"])}{${f}};`, name: fn.name };
    }
    case "x": {
      const [f] = exprs(fn, 1, ["y"], model);
      const domain = range("domain", fn.domain ?? layout.yaxis.range ?? DEFAULT_VIEW);
      return { line: `\\addplot${opts(["variable=y", domain, samples, colour, "no markers"])}({${f}},{y});`, name: fn.name };
    }
    case "param": {
      const [x, y] = exprs(fn, 2, ["t"], model);
      const domain = range("domain", fn.domain ?? DEFAULT_ANGLE);
      return { line: `\\addplot${opts(["variable=t", domain, samples, colour, "no markers"])}({${x}},{${y}});`, name: fn.name };
    }
    case "polar": {
      // formatPgfExpr writes θ as x, the plot's variable here.
      const [r] = exprs(fn, 1, ["θ"], model);
      const domain = range("domain", fn.domain ?? DEFAULT_ANGLE);
      return { line: `\\addplot${opts([domain, samples, colour, "no markers"])}({(${r})*cos(x)},{(${r})*sin(x)});`, name: fn.name };
    }
    default:
      return unmappable();
  }
}

function fn3dPlot(fn: ChartFn, index: number, model: ChartModel): Plot {
  const [n1, n2] = Array.isArray(fn.steps) ? fn.steps : [fn.steps, fn.steps];
  const samples = `samples=${samplesOf(n1, DEFAULT_SAMPLES_3D)}`;
  const samplesY = `samples y=${samplesOf(n2, DEFAULT_SAMPLES_3D)}`;
  switch (fn.kind) {
    case "surface": {
      const [f] = exprs(fn, 1, ["x", "y"], model);
      const domain = range("domain", fn.domain ?? DEFAULT_VIEW);
      const domainY = range("domain y", fn.domain2 ?? DEFAULT_VIEW);
      return { line: `\\addplot3${opts(["surf", domain, domainY, samples, samplesY])}{${f}};`, name: fn.name };
    }
    case "param3d": {
      const [x, y, z] = exprs(fn, 3, ["u", "v"], model);
      const domain = range("domain", fn.domain ?? DEFAULT_ANGLE);
      const domainY = range("domain y", fn.domain2 ?? DEFAULT_ANGLE);
      return { line: `\\addplot3${opts(["surf", "variable=u", "variable y=v", domain, domainY, samples, samplesY])}({${x}},{${y}},{${z}});`, name: fn.name };
    }
    case "curve3d": {
      const [x, y, z] = exprs(fn, 3, ["t"], model);
      const domain = range("domain", fn.domain ?? DEFAULT_ANGLE);
      return { line: `\\addplot3${opts(["variable=t", domain, samples, "samples y=0", `color=${colourOf(fn.color, index)}`, "no markers"])}({${x}},{${y}},{${z}});`, name: fn.name };
    }
    default:
      return unmappable();
  }
}

/** The index of a spreadsheet column letter (A is 0, AA is 26). */
function columnIndex(letter: string): number {
  let index = 0;
  for (const char of letter) { index = index * 26 + (char.charCodeAt(0) - 64); }
  return index - 1;
}

function columnOf(table: ChartTable, letter: string | undefined): Cell[] {
  if (letter === undefined) { return []; }
  return table.cols[columnIndex(letter)]?.values ?? [];
}

function isText(cells: readonly Cell[]): boolean {
  return cells.some((cell) => typeof cell === "string" && cell.trim() !== "");
}

/** The coordinate of one cell: a number, or a symbolic category; null for a gap. */
function coordinate(cell: Cell | undefined, symbolic: boolean): string | null {
  if (symbolic) {
    if (typeof cell !== "string" || cell.trim() === "") { return null; }
    return SYMBOL.test(cell.trim()) ? cell.trim() : unmappable();
  }
  return typeof cell === "number" && Number.isFinite(cell) ? num(cell) : null;
}

function coordinates(columns: readonly (readonly Cell[])[], symbolic: readonly boolean[]): string {
  const rows = Math.max(0, ...columns.map((c) => c.length));
  const points: string[] = [];
  for (let i = 0; i < rows; i += 1) {
    const parts = columns.map((c, j) => coordinate(c[i], symbolic[j] === true));
    if (parts.every((p): p is string => p !== null)) { points.push(`(${parts.join(",")})`); }
  }
  return `coordinates {${points.join(" ")}}`;
}

function markOptions(mode: string | undefined, fallback: string): string[] {
  const m = mode ?? fallback;
  return m === "markers" ? ["only marks"] : m === "lines+markers" ? ["mark=*"] : ["no markers"];
}

interface DataAxis { options: string[]; plots: Plot[]; is3d: boolean }

function dataPlots(model: ChartModel, table: ChartTable): DataAxis {
  const traces = model.traces;
  if (traces.length === 0) { unmappable(); }
  const is3d = traces.every((t) => t.type === "scatter3d");
  if (!is3d && traces.some((t) => t.type !== "scatter" && t.type !== "bar")) { unmappable(); }
  const allBars = traces.every((t) => t.type === "bar");
  const horizontal = allBars && traces.every((t) => t.orientation === "h");
  if (traces.some((t) => t.type === "bar" && (t.orientation === "h") !== horizontal)) { unmappable(); }
  // The category axis is x for vertical bars and lines, y for horizontal bars; it is symbolic when any trace has text on it.
  const symbolic = !is3d && traces.some((t) => isText(columnOf(table, t.x)));
  const categories: string[] = [];
  const plots = traces.map((trace: ChartTrace, index: number): Plot => {
    const colour = colourOf(trace.color, index);
    const xs = columnOf(table, trace.x);
    const ys = columnOf(table, trace.y);
    if (symbolic) {
      for (const cell of xs) {
        const c = coordinate(cell, true);
        if (c !== null && !categories.includes(c)) { categories.push(c); }
      }
    }
    if (trace.type === "scatter3d") {
      const zs = columnOf(table, trace.z?.[0]);
      return { line: `\\addplot3${opts([`color=${colour}`, ...markOptions(trace.mode, "markers")])} ${coordinates([xs, ys, zs], [false, false, false])};`, name: trace.name };
    }
    if (trace.type === "bar") {
      const own = allBars ? [] : ["ybar"];
      const points = horizontal ? coordinates([ys, xs], [false, symbolic]) : coordinates([xs, ys], [symbolic, false]);
      return { line: `\\addplot${opts([...own, `fill=${colour}`, `draw=${colour}`])} ${points};`, name: trace.name };
    }
    const points = coordinates([xs, ys], [symbolic, false]);
    if (trace.fill !== undefined && trace.fill !== "none") {
      return { line: `\\addplot${opts([`color=${colour}`, `fill=${colour}`, `fill opacity=${FILL_OPACITY}`, "no markers"])} ${points} \\closedcycle;`, name: trace.name };
    }
    return { line: `\\addplot${opts([`color=${colour}`, ...markOptions(trace.mode, "lines")])} ${points};`, name: trace.name };
  });
  const options: string[] = [];
  if (allBars) { options.push(`${horizontal ? "xbar" : "ybar"}${model.layout.barmode === "stack" ? " stacked" : ""}`); }
  if (symbolic) {
    const axis = horizontal ? "y" : "x";
    options.push(`symbolic ${axis} coords={${categories.join(",")}}`, `${axis}tick=data`);
  }
  return { options, plots, is3d };
}

function axisOptions(letter: "x" | "y" | "z", axis: ChartAxis | undefined, fallbackLabel: string | undefined, rangeAllowed: boolean): string[] {
  const out: string[] = [];
  const label = axis?.title ?? fallbackLabel;
  if (label !== undefined && label !== "") { out.push(`${letter}label={${axis?.title !== undefined ? tex(label) : label}}`); }
  if (axis?.type === "log") { out.push(`${letter}mode=log`); }
  const r = axis?.range;
  if (rangeAllowed && r !== undefined && (axis?.type !== "log" || (r[0] > 0 && r[1] > 0))) { out.push(`${letter}min=${num(r[0])}`, `${letter}max=${num(r[1])}`); }
  if (axis?.grid === true) { out.push(`${letter}majorgrids`); }
  return out;
}

/** pgfplots' view={azimuth}{elevation} looking from the camera eye toward the centre (azimuth 0 looks from -y toward +y). */
function viewOf(model: ChartModel): string {
  const camera = model.layout.camera;
  const eye = camera?.eye ?? DEFAULT_EYE;
  const centre = camera?.center ?? { x: 0, y: 0, z: 0 };
  const [dx, dy, dz] = [eye.x - centre.x, eye.y - centre.y, eye.z - centre.z];
  const flat = Math.hypot(dx, dy);
  const az = flat === 0 ? 0 : (Math.atan2(dx, -dy) * 180) / Math.PI;
  const el = flat === 0 && dz === 0 ? 30 : (Math.atan2(dz, flat) * 180) / Math.PI;
  const round = (v: number): string => num(Math.round(v * 1e4) / 1e4);
  return `view={${round(az)}}{${round(el)}}`;
}

function picture(model: ChartModel, table: ChartTable | null): string {
  const layout = model.layout;
  let plots: Plot[];
  let extra: string[] = [];
  let is3d = model.kind === "fn3d";
  if (model.kind === "data") {
    if (table === null) { unmappable(); }
    if (Math.max(0, ...table.cols.map((c) => c.values.length)) > MAX_ROWS) { unmappable(); }
    const data = dataPlots(model, table);
    plots = data.plots;
    extra = data.options;
    is3d = data.is3d;
  } else {
    const visible = model.fns.map((fn, index) => ({ fn, index })).filter(({ fn }) => fn.hidden !== true);
    if (visible.length === 0) { unmappable(); }
    plots = visible.map(({ fn, index }) => (is3d ? fn3dPlot(fn, index, model) : fn2dPlot(fn, index, model)));
  }
  const isFn = model.kind !== "data";
  const widthPx = layout.width ?? DEFAULT_PX.width;
  const heightPx = layout.height ?? DEFAULT_PX.height;
  const options = [
    `width=${WIDTH_CM}cm`,
    `height=${num((WIDTH_CM * heightPx) / widthPx)}cm`,
    ...(model.title !== undefined && model.title !== "" ? [`title={${tex(model.title)}}`] : []),
    ...axisOptions("x", layout.xaxis, isFn ? "$x$" : undefined, true),
    ...axisOptions("y", layout.yaxis, isFn ? "$y$" : undefined, true),
    ...(is3d ? [...axisOptions("z", layout.zaxis, isFn ? "$z$" : undefined, true), viewOf(model)] : []),
    ...extra,
    "trig format plots=rad",
  ];
  const lines = ["\\begin{tikzpicture}", `\\begin{axis}${opts(options)}`];
  for (const plot of plots) {
    lines.push(plot.line);
    if (layout.legend.show && plot.name !== undefined && plot.name !== "") { lines.push(`\\addlegendentry{${tex(plot.name)}}`); }
  }
  lines.push("\\end{axis}", "\\end{tikzpicture}");
  return lines.join("\n");
}

/**
 * The pgfplots text of a chart, between the guard lines and without them: a tikzpicture with one axis and an \addplot per
 * visible function or trace. Null (image-only) for a chart pgfplots cannot draw: pie, heatmap, contour, surface, mesh3d,
 * histogram and box traces, implicit curves, relations other than '=', a chart with nothing visible, a data chart with no
 * table or with more than 2000 rows, or an expression that does not parse.
 */
export function formatChartPgf(model: ChartModel, table: ChartTable | null): string | null {
  try {
    return picture(model, table);
  } catch (error) {
    if (error instanceof Unmappable) { return null; }
    throw error;
  }
}
