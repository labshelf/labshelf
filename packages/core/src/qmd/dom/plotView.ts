// Draws a labshelf-plot spec with plotly.js: the lazy bundle loader and the spec-to-figure mapping with the page theme's
// colours; the plot handle that updates in place and redraws on a theme change is in plotRender.ts.
import type { PlotAxis, PlotMeshTrace, PlotSpec, PlotSurfaceTrace, PlotTrace, PlotValue } from "../item/index.js";

/** The part of the plotly.js API core calls. */
export interface PlotlyApi {
  react(root: HTMLElement, data: readonly object[], layout?: object, config?: object): Promise<unknown>;
  purge(root: HTMLElement): void;
  relayout(root: HTMLElement, update: object): Promise<unknown>;
  downloadImage(root: HTMLElement, options: { format: "png"; filename: string }): Promise<unknown>;
  Plots: { resize(root: HTMLElement): unknown };
}

export type PlotlyLoader = () => Promise<PlotlyApi>;

/**
 * The ids of the <style> elements Plotly looks up before creating its own: its global style sheet and the bundled
 * maplibre style. The second is a content hash of plotly.js-strict-dist-min 4.2.0; re-run the renderer spike
 * (documents/plans/interactive-plots/research/renderer-spike.md) on every plotly upgrade.
 */
const PLOTLY_STYLE_IDS: readonly string[] = [
  "plotly.js-style-global",
  "9f215cf04c5486422605d13261cb87401f4e7763b6296af81e98efbc0130da53",
];

/**
 * Pre-creates the empty <style> elements Plotly looks up by id, carrying the page's script nonce.
 * PLATFORM: nonce-only style-src hosts (htmlShell, Spaces) block un-nonced <style> elements Plotly would create; it
 * finds these by id and writes its rules through CSSOM.
 */
export function preparePlotlyStyles(doc: Document): void {
  const script = doc.querySelector<HTMLScriptElement>("script[nonce]");
  const nonce = script ? script.nonce || script.getAttribute("nonce") || "" : "";
  for (const id of PLOTLY_STYLE_IDS) {
    if (doc.getElementById(id)) continue;
    const style = doc.createElement("style");
    style.id = id;
    style.nonce = nonce;
    style.setAttribute("nonce", nonce);
    doc.head.appendChild(style);
  }
}

let plotlyLoad: Promise<PlotlyApi> | null = null;

/**
 * Loads the plotly.js strict bundle (no `eval`, no `new Function`) once per page, after pre-creating the style elements it looks up.
 * TRAP: it is about 5 MB of minified UMD with import-time side effects (it injects a <style> element); only ever a
 * dynamic import, never static.
 */
export const loadCorePlotly: PlotlyLoader = () => {
  if (!plotlyLoad) {
    preparePlotlyStyles(document);
    // @ts-expect-error the package ships no types; PlotlyApi above names the part core uses.
    plotlyLoad = import("plotly.js-strict-dist-min").then(
      (mod: { default?: unknown }) => (mod.default ?? mod) as PlotlyApi,
      (error: unknown) => {
        plotlyLoad = null;
        throw error;
      },
    );
  }
  return plotlyLoad;
};

/** The page colours a figure takes: text (--ls-fg), quiet text for ticks and axis titles (--ls-desc), hairlines (--ls-border-soft), font (--ls-font), ground (--ls-bg). */
export interface PlotTheme { text: string; muted: string; grid: string; font: string; bg: string; palette: string[] }

const DEFAULT_PLOT_PALETTE: readonly string[] = [
  "#4e79a7", "#f28e2b", "#e15759", "#76b7b2", "#59a14f", "#edc948", "#b07aa1", "#ff9da7", "#9c755f", "#bab0ac",
];

export function readPlotTheme(element: Element): PlotTheme {
  const view = element.ownerDocument.defaultView ?? window;
  const style = view.getComputedStyle(element);
  const read = (name: string): string => style.getPropertyValue(name).trim();
  const palette = read("--qmd-plot-palette").split(",").map((part) => part.trim()).filter((part) => part !== "");
  return {
    text: read("--ls-fg") || "#808080",
    muted: read("--ls-desc") || read("--ls-fg") || "#808080",
    grid: read("--ls-border-soft") || "rgba(128, 128, 128, .2)",
    font: read("--ls-font") || "sans-serif",
    bg: read("--ls-bg") || "#ffffff",
    palette: palette.length > 0 ? palette : [...DEFAULT_PLOT_PALETTE],
  };
}

export function sameTheme(a: PlotTheme, b: PlotTheme): boolean {
  return a.text === b.text && a.muted === b.muted && a.grid === b.grid && a.font === b.font && a.bg === b.bg
    && a.palette.length === b.palette.length && a.palette.every((colour, i) => colour === b.palette[i]);
}

export interface PlotlyFigure { data: object[]; layout: object; config: object }

/** The soft shading of a solid surface or mesh: mostly ambient and diffuse light, a little matte sheen. */
const SOFT_LIGHTING = { ambient: 0.6, diffuse: 0.6, specular: 0.05, roughness: 0.9, fresnel: 0.1 };

/** How a 3D plot draws its surfaces and meshes: a shaded surface, only its grid lines, or the shaded surface with its grid lines on top. */
export type PlotSurfaceStyle = "surface" | "wireframe" | "both";

/** The order the surface styles take turns in (the W key). */
export const PLOT_SURFACE_STYLES: readonly PlotSurfaceStyle[] = ["surface", "wireframe", "both"];

/** How a 3D plot colours its surfaces and meshes: each in its trace's one colour, or each point by its height on the Viridis scale. */
export type PlotSurfaceColour = "single" | "height";

/** The perceptual colour scale of a surface coloured by height. */
const HEIGHT_COLORSCALE = "Viridis";

/** The most edge segments a wireframe draws over the whole spec; a spec with more is drawn as a surface. */
const PLOT_WIREFRAME_SEGMENTS = 30000;

/** True when `spec` is 3D and holds a surface or mesh trace, the traces a surface style applies to. */
export function hasPlotSurfaces(spec: PlotSpec): boolean {
  return spec.dim === 3 && spec.traces.some((trace) => trace.type === "surface" || trace.type === "mesh");
}

type Vec3 = [number, number, number];

const finiteNumber = (value: PlotValue | undefined): value is number => typeof value === "number" && Number.isFinite(value);

/**
 * The wire of one surface or mesh: points joined into one polyline with null breaks, how many segments it holds, and per point
 * the small offset (data units) that lifts it off the surface along the surface's normal; 0 when no lift was asked for.
 */
interface Wire { x: PlotValue[]; y: PlotValue[]; z: PlotValue[]; lift: (Vec3 | null)[]; segments: number }

function pushPoint(wire: Wire, p: Vec3, lift: Vec3): void {
  wire.x.push(p[0]); wire.y.push(p[1]); wire.z.push(p[2]); wire.lift.push(lift);
}

function pushBreak(wire: Wire): void {
  wire.x.push(null); wire.y.push(null); wire.z.push(null); wire.lift.push(null);
}

/** How far a wire drawn over its surface is lifted off it, in units of Plotly's scene cube: enough to beat depth fighting, too little to see. */
const WIRE_LIFT = 0.004;
const NO_LIFT: Vec3 = [0, 0, 0];

/**
 * The per-axis factors that map data units to Plotly's scene cube (1 over each axis's span over the surfaces and meshes, or its
 * set range), or null when an axis is logarithmic and a lift in data units would not be even.
 */
function sceneScale(spec: PlotSpec): Vec3 | null {
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  const add = (axis: 0 | 1 | 2, value: PlotValue | undefined): void => {
    if (!finiteNumber(value)) return;
    lo[axis] = Math.min(lo[axis], value);
    hi[axis] = Math.max(hi[axis], value);
  };
  for (const trace of spec.traces) {
    if (trace.type === "surface") {
      for (const x of trace.x) add(0, x);
      for (const y of trace.y) add(1, y);
      for (const row of trace.z) for (const z of row) add(2, z);
    } else if (trace.type === "mesh") {
      for (const v of trace.vertices) { add(0, v[0]); add(1, v[1]); add(2, v[2]); }
    }
  }
  const scale: Vec3 = [1, 1, 1];
  for (const [n, name] of (["x", "y", "z"] as const).entries()) {
    const axis = spec.axes[name];
    if (axis?.log === true) return null;
    const span = axis?.range ? Math.abs(axis.range[1] - axis.range[0]) : hi[n]! - lo[n]!;
    scale[n] = span > 0 && Number.isFinite(span) ? 1 / span : 1;
  }
  return scale;
}

/** A unit normal in scene-cube units turned into a WIRE_LIFT offset in data units. */
function liftOf(normal: Vec3, scale: Vec3): Vec3 {
  const length = Math.hypot(normal[0], normal[1], normal[2]);
  if (!(length > 0)) return NO_LIFT;
  return [normal[0] / length * WIRE_LIFT / scale[0], normal[1] / length * WIRE_LIFT / scale[1], normal[2] / length * WIRE_LIFT / scale[2]];
}

/** The slope dz/dc at grid index `n` from its finite neighbours (central where it can, one-sided at an edge or a gap). */
function gridSlope(coords: readonly number[], zAt: (n: number) => number | null, n: number): number {
  const here = zAt(n)!;
  const prev = n > 0 ? zAt(n - 1) : null;
  const next = n < coords.length - 1 ? zAt(n + 1) : null;
  const [ca, za] = prev !== null ? [coords[n - 1]!, prev] : [coords[n]!, here];
  const [cb, zb] = next !== null ? [coords[n + 1]!, next] : [coords[n]!, here];
  return cb !== ca ? (zb - za) / (cb - ca) : 0;
}

/** A surface grid's rows and columns as polylines, broken at a missing z; lifted along the grid's normal when `scale` is given. */
function surfaceWire(trace: PlotSurfaceTrace, scale: Vec3 | null): Wire {
  const wire: Wire = { x: [], y: [], z: [], lift: [], segments: 0 };
  const zAt = (i: number, j: number): number | null => {
    const z = trace.z[j]?.[i];
    return finiteNumber(z) ? z : null;
  };
  const lift = (i: number, j: number): Vec3 => {
    if (!scale) return NO_LIFT;
    const fx = gridSlope(trace.x, (n) => zAt(n, j), i) * scale[2] / scale[0];
    const fy = gridSlope(trace.y, (n) => zAt(i, n), j) * scale[2] / scale[1];
    return liftOf([-fx, -fy, 1], scale);
  };
  const line = (count: number, at: (n: number) => [number, number]): void => {
    let run = 0;
    for (let n = 0; n < count; n++) {
      const [i, j] = at(n);
      const z = zAt(i, j);
      if (z === null) {
        if (run > 0) pushBreak(wire);
        run = 0;
        continue;
      }
      pushPoint(wire, [trace.x[i]!, trace.y[j]!, z], lift(i, j));
      if (run > 0) wire.segments++;
      run++;
    }
    if (run > 0) pushBreak(wire);
  };
  for (let j = 0; j < trace.y.length; j++) line(trace.x.length, (i) => [i, j]);
  for (let i = 0; i < trace.x.length; i++) line(trace.y.length, (j) => [i, j]);
  return wire;
}

/** A mesh's vertex normals (face normals in scene-cube units, summed by area) as lifts, or none without `scale`. */
function meshLifts(trace: PlotMeshTrace, scale: Vec3 | null): Vec3[] | null {
  if (!scale) return null;
  const sums: Vec3[] = trace.vertices.map(() => [0, 0, 0]);
  for (const face of trace.faces) {
    const [a, b, c] = face.map((n) => trace.vertices[n]);
    if (!a || !b || !c) continue;
    const u = [0, 1, 2].map((k) => (b[k]! - a[k]!) * scale[k]!) as Vec3;
    const w = [0, 1, 2].map((k) => (c[k]! - a[k]!) * scale[k]!) as Vec3;
    const cross: Vec3 = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    for (const n of face) {
      const sum = sums[n];
      if (sum) { sum[0] += cross[0]; sum[1] += cross[1]; sum[2] += cross[2]; }
    }
  }
  return sums.map((sum) => liftOf(sum, scale));
}

/**
 * A mesh's edges as one polyline of null-separated segments, each shared edge once. Two consecutive faces [a,b,c], [a,c,d] are
 * one quad fanned from a (how Mathematica's Plot3D and matplotlib's plot_surface split a grid cell): their diagonal a–c is dropped
 * so the wire shows the grid, not the triangles. Lifted along the vertex normals when `scale` is given.
 */
function meshWire(trace: PlotMeshTrace, scale: Vec3 | null): Wire {
  const wire: Wire = { x: [], y: [], z: [], lift: [], segments: 0 };
  const count = trace.vertices.length;
  const lifts = meshLifts(trace, scale);
  const seen = new Set<number>();
  const edge = (p: number, q: number): void => {
    if (p === q) return;
    const key = Math.min(p, q) * count + Math.max(p, q);
    if (seen.has(key)) return;
    seen.add(key);
    const a = trace.vertices[p];
    const b = trace.vertices[q];
    if (!a || !b) return;
    pushPoint(wire, a, lifts?.[p] ?? NO_LIFT);
    pushPoint(wire, b, lifts?.[q] ?? NO_LIFT);
    pushBreak(wire);
    wire.segments++;
  };
  const faces = trace.faces;
  for (let n = 0; n < faces.length; n++) {
    const [a, b, c] = faces[n]!;
    const next = faces[n + 1];
    if (next && next[0] === a && next[1] === c) {
      const d = next[2];
      edge(a, b); edge(b, c); edge(c, d); edge(d, a);
      n++;
      continue;
    }
    edge(a, b); edge(b, c); edge(c, a);
  }
  return wire;
}

/**
 * The wires of a spec's surfaces and meshes by trace index, lifted off their surfaces when `scale` is given, or null when they
 * hold more than PLOT_WIREFRAME_SEGMENTS segments.
 */
function plotWires(spec: PlotSpec, scale: Vec3 | null): Map<number, Wire> | null {
  const wires = new Map<number, Wire>();
  let segments = 0;
  for (const [i, trace] of spec.traces.entries()) {
    if (trace.type !== "surface" && trace.type !== "mesh") continue;
    const wire = trace.type === "surface" ? surfaceWire(trace, scale) : meshWire(trace, scale);
    segments += wire.segments;
    if (segments > PLOT_WIREFRAME_SEGMENTS) return null;
    wires.set(i, wire);
  }
  return wires;
}

/** True when a 3D spec's surfaces and meshes fit a wireframe; false for a spec with none or with too many edges. */
export function plotWireframeFits(spec: PlotSpec): boolean {
  return hasPlotSurfaces(spec) && plotWires(spec, null) !== null;
}

/** The lowest and highest finite z over a spec's surfaces and meshes, the ends of its height colour scale; null when it has none. */
function heightRange(spec: PlotSpec): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  const add = (z: PlotValue | undefined): void => {
    if (!finiteNumber(z)) return;
    lo = Math.min(lo, z);
    hi = Math.max(hi, z);
  };
  for (const trace of spec.traces) {
    if (trace.type === "surface") for (const row of trace.z) for (const z of row) add(z);
    else if (trace.type === "mesh") for (const v of trace.vertices) add(v[2]);
  }
  return lo <= hi ? [lo, hi] : null;
}

/** The px width of a wireframe's lines, and of the grid lines drawn over a surface. */
const WIRE_WIDTH = 1.25;
const OVERLAY_WIDTH = 1;
/** The opacity of the grid lines drawn over a surface. */
const OVERLAY_ALPHA = 0.55;

/** The red, green and blue of a `#rgb`, `#rrggbb(aa)` or `rgb(a)()` colour, or null for any other form. */
function rgbOf(colour: string): Vec3 | null {
  const hex = /^#([0-9a-f]{3,8})$/i.exec(colour.trim())?.[1];
  if (hex && (hex.length === 3 || hex.length === 6 || hex.length === 8)) {
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex.slice(0, 6);
    return [0, 2, 4].map((n) => parseInt(full.slice(n, n + 2), 16)) as Vec3;
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(colour.trim());
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
}

/** The colour of the grid lines drawn over a surface: the darker of the theme's text and ground (the ground on a dark theme, the text on a light one), part transparent. */
function overlayColour(theme: PlotTheme): string {
  const light = (rgb: Vec3): number => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  const dark = [theme.text, theme.bg].map(rgbOf).filter((rgb): rgb is Vec3 => rgb !== null).sort((a, b) => light(a) - light(b))[0] ?? [0, 0, 0];
  return `rgba(${dark.map((n) => Math.round(n)).join(", ")}, ${OVERLAY_ALPHA})`;
}

/** The Viridis colouring by height of a trace, its line or its points, from the spec's height range. */
function heightColours(range: [number, number]): Record<string, unknown> {
  return { colorscale: HEIGHT_COLORSCALE, cmin: range[0], cmax: range[1], showscale: false };
}

function wireTrace(trace: PlotTrace, wire: Wire, color: string, height: [number, number] | null): object {
  const named = trace.name !== undefined ? { name: trace.name, hoverinfo: "none" } : { hoverinfo: "none" };
  const line = height ? { color: wire.z, ...heightColours(height), width: WIRE_WIDTH } : { color, width: WIRE_WIDTH };
  return { type: "scatter3d", ...named, mode: "lines", x: wire.x, y: wire.y, z: wire.z, connectgaps: false, line };
}

/**
 * The grid lines drawn over a surface: the wire lifted to both sides of it (the side facing the camera shows, the other hides
 * behind the surface), thin and dark, out of the legend and the hover. Added after every spec trace so the hover's trace index holds.
 */
function overlayTrace(wire: Wire, color: string): object {
  const x: PlotValue[] = [];
  const y: PlotValue[] = [];
  const z: PlotValue[] = [];
  for (const sign of [1, -1]) {
    for (const [n, lift] of wire.lift.entries()) {
      if (!lift) { x.push(null); y.push(null); z.push(null); continue; }
      x.push(wire.x[n]! + sign * lift[0]);
      y.push(wire.y[n]! + sign * lift[1]);
      z.push(wire.z[n]! + sign * lift[2]);
    }
  }
  return {
    type: "scatter3d", mode: "lines", hoverinfo: "skip", showlegend: false, x, y, z, connectgaps: false,
    line: { color, width: OVERLAY_WIDTH },
  };
}

function toTrace(trace: PlotTrace, color: string, dim: 2 | 3, height: [number, number] | null): object {
  // The output draws its own hover card (attachPlotTooltip in plotRender.ts) from Plotly's hover events; Plotly's label stays off.
  const named = trace.name !== undefined ? { name: trace.name, hoverinfo: "none" } : { hoverinfo: "none" };
  switch (trace.type) {
    case "line":
    case "points": {
      const style = trace.type === "line" ? { mode: "lines", line: { color } } : { mode: "markers", marker: { color } };
      return dim === 3
        ? { type: "scatter3d", ...named, x: trace.x, y: trace.y, z: trace.z, ...style }
        : { type: "scatter", ...named, x: trace.x, y: trace.y, ...style };
    }
    case "surface":
      // TRAP: showscale stays false: Plotly's colour bar writes inline style attributes the nonce-only CSP blocks.
      return {
        type: "surface", ...named, x: trace.x, y: trace.y, z: trace.z, showscale: false,
        ...(height ? { ...heightColours(height), surfacecolor: trace.z } : { colorscale: [[0, color], [1, color]] }),
        opacity: 1, lighting: SOFT_LIGHTING,
      };
    case "mesh":
      return {
        type: "mesh3d",
        ...named,
        opacity: 1,
        flatshading: false,
        lighting: SOFT_LIGHTING,
        x: trace.vertices.map((v) => v[0]),
        y: trace.vertices.map((v) => v[1]),
        z: trace.vertices.map((v) => v[2]),
        i: trace.faces.map((f) => f[0]),
        j: trace.faces.map((f) => f[1]),
        k: trace.faces.map((f) => f[2]),
        ...(height ? { ...heightColours(height), intensity: trace.vertices.map((v) => v[2]), intensitymode: "vertex" } : { color }),
      };
  }
}

/** Tick labels and axis titles: quiet, small, in the page's secondary text colour. */
const AXIS_TEXT_SIZE = 11;
/** Plotly draws at most this many ticks per axis, about five. */
const AXIS_TICKS = 6;

/** The style both 2D and 3D axes share; the 2D axis titles are drawn as annotations (axisTitles) so nothing is rotated. */
function toAxis(axis: PlotAxis | undefined, theme: PlotTheme): Record<string, unknown> {
  const log = axis?.log === true;
  const out: Record<string, unknown> = {
    type: log ? "log" : "linear",
    gridcolor: theme.grid,
    gridwidth: 1,
    zeroline: false,
    showline: false,
    ticks: "",
    nticks: AXIS_TICKS,
    tickfont: { family: theme.font, size: AXIS_TEXT_SIZE, color: theme.muted },
    color: theme.muted,
    // Plain decimals down to 0.001 and up to 9999, powers of ten (2×10⁴, 5×10⁻⁵) beyond, never SI letters.
    exponentformat: "power",
    separatethousands: false,
    showspikes: false,
  };
  const range = axisRange(axis);
  if (range) out.range = range;
  return out;
}

/** A 3D scene axis: the shared style with its title small in --ls-desc and no background plane. */
function toSceneAxis(axis: PlotAxis | undefined, theme: PlotTheme): Record<string, unknown> {
  const out = toAxis(axis, theme);
  if (axis?.label !== undefined) out.title = { text: axis.label, font: { family: theme.font, size: AXIS_TEXT_SIZE, color: theme.muted } };
  out.showbackground = false;
  return out;
}

/** The px between the plot area and an axis title: the tick labels' line and a small gap. */
const X_TITLE_SHIFT = 22;
const Y_TITLE_SHIFT = 6;
/** The extra room under the plot area an x title needs, and above it a y title needs under a figure title. */
const X_TITLE_ROOM = 44;
const Y_TITLE_ROOM = 18;

/** The 2D axis titles as annotations at paper coordinates: x at the right end under the tick labels, y level at the top left above the axis. */
function axisTitles(spec: PlotSpec, theme: PlotTheme): object[] {
  const font = { family: theme.font, size: AXIS_TEXT_SIZE, color: theme.muted };
  const base = { xref: "paper", yref: "paper", showarrow: false, font, captureevents: false };
  const out: object[] = [];
  const x = spec.axes.x?.label;
  const y = spec.axes.y?.label;
  if (x !== undefined) out.push({ ...base, text: x, x: 1, xanchor: "right", y: 0, yanchor: "top", yshift: -X_TITLE_SHIFT });
  if (y !== undefined) out.push({ ...base, text: y, x: 0, xanchor: "left", y: 1, yanchor: "bottom", yshift: Y_TITLE_SHIFT });
  return out;
}

/** The axis's set range in Plotly's units (log10 on a log axis), or null when it autoranges. */
function axisRange(axis: PlotAxis | undefined): number[] | null {
  if (!axis?.range) return null;
  return axis.log === true ? [Math.log10(axis.range[0]), Math.log10(axis.range[1])] : [...axis.range];
}

/** Plotly's default 3D camera, the view a scene opens with. */
const DEFAULT_CAMERA = { eye: { x: 1.25, y: 1.25, z: 1.25 }, center: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 } };

/** The relayout update that returns a plot to its first view: each 2D axis to its set range or autorange, a 3D scene to the default camera. */
export function plotResetView(spec: PlotSpec): Record<string, unknown> {
  if (spec.dim === 3) return { "scene.camera": DEFAULT_CAMERA };
  const update: Record<string, unknown> = {};
  for (const name of ["x", "y"] as const) {
    const range = axisRange(spec.axes[name]);
    if (range) update[`${name}axis.range`] = range;
    else update[`${name}axis.autorange`] = true;
  }
  return update;
}

/** Which way a plot's Zoom in and Zoom out buttons go. */
export type PlotZoomDirection = "in" | "out";

/**
 * What a drag does: in 2D a pan (the default) or a box zoom; in 3D a turntable rotate (the default), a free orbit or a pan.
 */
export type PlotDragMode = "pan" | "zoom" | "turntable" | "orbit";

/** The drag a plot of `dim` dimensions opens with. */
export function defaultDragMode(dim: 2 | 3): PlotDragMode {
  return dim === 3 ? "turntable" : "pan";
}

/** The relayout update that sets the drag of a plot of `dim` dimensions. */
export function plotDragModeUpdate(dim: 2 | 3, mode: PlotDragMode): Record<string, unknown> {
  if (dim === 3) return { "scene.dragmode": mode };
  return { dragmode: mode === "zoom" ? "zoom" : "pan" };
}

/** The relayout update that fits both 2D axes to the data, ignoring the spec's own ranges. */
export const PLOT_AUTOSCALE: Readonly<Record<string, unknown>> = { "xaxis.autorange": true, "yaxis.autorange": true };

type PlotRange = [number, number];
interface PlotVec { x: number; y: number; z: number }

/** The visible part of a drawn plot: the 2D axis ranges in Plotly's units (log10 on a log axis) or the 3D camera. */
export type PlotView =
  | { dim: 2; x: PlotRange; y: PlotRange }
  | { dim: 3; eye: PlotVec; center: PlotVec; up: PlotVec };

/** The 3D view a scene opens with and Reset view returns to. */
export const DEFAULT_PLOT_VIEW_3D: PlotView = { dim: 3, ...DEFAULT_CAMERA };

const finitePair = (value: unknown): value is PlotRange =>
  Array.isArray(value) && value.length === 2 && value.every((part) => typeof part === "number" && Number.isFinite(part));

const finiteVec = (value: unknown): value is PlotVec => {
  const v = value as Partial<PlotVec> | null | undefined;
  return v != null && [v.x, v.y, v.z].every((part) => typeof part === "number" && Number.isFinite(part));
};

/** The current view of a drawn plot: the full layout Plotly keeps on its root (`_fullLayout`), or null before a draw. */
function fullLayoutOf(root: HTMLElement): Record<string, unknown> | null {
  const layout = (root as HTMLElement & { _fullLayout?: unknown })._fullLayout;
  return layout && typeof layout === "object" ? layout as Record<string, unknown> : null;
}

interface SceneLayout { camera?: { eye?: unknown; center?: unknown; up?: unknown }; _scene?: { getCamera?: () => unknown } }

/** The live view of the drawn plot on `root`, or null before a draw or when an axis has no numeric range. */
export function readPlotView(root: HTMLElement, dim: 2 | 3): PlotView | null {
  const layout = fullLayoutOf(root);
  if (!layout) return null;
  if (dim === 3) {
    const scene = layout.scene as SceneLayout | undefined;
    // The scene's own camera follows a drag at once; the layout's copy only after Plotly saves it.
    let live: SceneLayout["camera"] | undefined;
    try {
      live = scene?._scene?.getCamera?.() as SceneLayout["camera"] | undefined;
    } catch {
      live = undefined;
    }
    const camera = live ?? scene?.camera;
    const pick = (value: unknown, fallback: PlotVec): PlotVec => finiteVec(value) ? { x: value.x, y: value.y, z: value.z } : { ...fallback };
    return {
      dim: 3,
      eye: pick(camera?.eye, DEFAULT_CAMERA.eye),
      center: pick(camera?.center, DEFAULT_CAMERA.center),
      up: pick(camera?.up, DEFAULT_CAMERA.up),
    };
  }
  const x = (layout.xaxis as { range?: unknown } | undefined)?.range;
  const y = (layout.yaxis as { range?: unknown } | undefined)?.range;
  return finitePair(x) && finitePair(y) ? { dim: 2, x: [x[0], x[1]], y: [y[0], y[1]] } : null;
}

/** The plot area of a drawn 2D plot in px from the root's top-left corner, or null before a draw. */
export interface PlotArea { left: number; top: number; width: number; height: number }

export function readPlotArea(root: HTMLElement): PlotArea | null {
  const layout = fullLayoutOf(root);
  const xa = layout?.xaxis as { _offset?: unknown; _length?: unknown } | undefined;
  const ya = layout?.yaxis as { _offset?: unknown; _length?: unknown } | undefined;
  const num = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
  if (!xa || !ya || !num(xa._offset) || !num(xa._length) || !num(ya._offset) || !num(ya._length)) return null;
  if (xa._length <= 0 || ya._length <= 0) return null;
  return { left: xa._offset, top: ya._offset, width: xa._length, height: ya._length };
}

/** The data point (in range units) under the pixel `px`, `py` of the root, given the plot area and the 2D view. */
export function plotPointAt(view: PlotView, area: PlotArea, px: number, py: number): { x: number; y: number } | null {
  if (view.dim !== 2) return null;
  const fx = (px - area.left) / area.width;
  const fy = (py - area.top) / area.height;
  return { x: view.x[0] + fx * (view.x[1] - view.x[0]), y: view.y[1] - fy * (view.y[1] - view.y[0]) };
}

/** The relayout update that shows `view`. */
export function plotViewUpdate(view: PlotView): Record<string, unknown> {
  if (view.dim === 2) return { "xaxis.range": [...view.x], "yaxis.range": [...view.y] };
  return { "scene.camera.eye": { ...view.eye }, "scene.camera.center": { ...view.center }, "scene.camera.up": { ...view.up } };
}

/** The narrowest span a 2D zoom goes to, relative to the axis's magnitude, before floating point runs out. */
const MIN_RELATIVE_SPAN = 1e-9;
/** How close and how far a 3D zoom brings the camera to the centre of the scene. */
const MIN_EYE_DISTANCE = 0.1;
const MAX_EYE_DISTANCE = 40;

function scaleRange(range: PlotRange, anchor: number, factor: number): PlotRange {
  const next: PlotRange = [anchor + (range[0] - anchor) * factor, anchor + (range[1] - anchor) * factor];
  const span = Math.abs(next[1] - next[0]);
  const magnitude = Math.max(Math.abs(next[0]), Math.abs(next[1]), 1e-300);
  if (!next.every(Number.isFinite) || (factor < 1 && span < magnitude * MIN_RELATIVE_SPAN)) return range;
  return next;
}

/**
 * Scales the view by `factor` (below 1 zooms in): each 2D range about `anchor` (its centre when absent), or the 3D camera eye
 * toward or away from the camera centre, within limits.
 */
export function zoomPlotView(view: PlotView, factor: number, anchor?: { x: number; y: number } | null): PlotView {
  if (view.dim === 2) {
    const ax = anchor?.x ?? (view.x[0] + view.x[1]) / 2;
    const ay = anchor?.y ?? (view.y[0] + view.y[1]) / 2;
    return { dim: 2, x: scaleRange(view.x, ax, factor), y: scaleRange(view.y, ay, factor) };
  }
  const d = { x: view.eye.x - view.center.x, y: view.eye.y - view.center.y, z: view.eye.z - view.center.z };
  const distance = Math.hypot(d.x, d.y, d.z);
  if (distance === 0) return view;
  const target = Math.min(MAX_EYE_DISTANCE, Math.max(MIN_EYE_DISTANCE, distance * factor));
  const k = target / distance;
  return { ...view, eye: { x: view.center.x + d.x * k, y: view.center.y + d.y * k, z: view.center.z + d.z * k } };
}

/** Shifts a 2D view by fractions of its spans (positive moves toward larger values); a 3D view is returned as is. */
export function panPlotView(view: PlotView, fx: number, fy: number): PlotView {
  if (view.dim !== 2) return view;
  const dx = (view.x[1] - view.x[0]) * fx;
  const dy = (view.y[1] - view.y[0]) * fy;
  return { dim: 2, x: [view.x[0] + dx, view.x[1] + dx], y: [view.y[0] + dy, view.y[1] + dy] };
}

/** The highest a 3D rotate lifts the camera above (or below) the horizontal plane, short of the pole. */
const MAX_ELEVATION = Math.PI / 2 - 0.05;

/** Turns the 3D camera about the centre: `azimuth` radians around the vertical (z) axis, `elevation` radians up or down. */
export function rotatePlotView(view: PlotView, azimuth: number, elevation: number): PlotView {
  if (view.dim !== 3) return view;
  const d = { x: view.eye.x - view.center.x, y: view.eye.y - view.center.y, z: view.eye.z - view.center.z };
  const cos = Math.cos(azimuth);
  const sin = Math.sin(azimuth);
  const rx = d.x * cos - d.y * sin;
  const ry = d.x * sin + d.y * cos;
  const horizontal = Math.hypot(rx, ry);
  const distance = Math.hypot(horizontal, d.z);
  if (distance === 0) return view;
  const lifted = Math.max(-MAX_ELEVATION, Math.min(MAX_ELEVATION, Math.atan2(d.z, horizontal) + elevation));
  const nextHorizontal = distance * Math.cos(lifted);
  const ux = horizontal > 0 ? rx / horizontal : 1;
  const uy = horizontal > 0 ? ry / horizontal : 0;
  return {
    ...view,
    eye: { x: view.center.x + ux * nextHorizontal, y: view.center.y + uy * nextHorizontal, z: view.center.z + distance * Math.sin(lifted) },
  };
}

const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const mixVec = (a: PlotVec, b: PlotVec, t: number): PlotVec => ({ x: mix(a.x, b.x, t), y: mix(a.y, b.y, t), z: mix(a.z, b.z, t) });

/** The view `t` (0 to 1) of the way from `a` to `b`; `b` when their dimensions differ. */
export function blendPlotView(a: PlotView, b: PlotView, t: number): PlotView {
  if (a.dim === 2 && b.dim === 2) return { dim: 2, x: [mix(a.x[0], b.x[0], t), mix(a.x[1], b.x[1], t)], y: [mix(a.y[0], b.y[0], t), mix(a.y[1], b.y[1], t)] };
  if (a.dim === 3 && b.dim === 3) return { dim: 3, eye: mixVec(a.eye, b.eye, t), center: mixVec(a.center, b.center, t), up: mixVec(a.up, b.up, t) };
  return b;
}

/** Figure margins in px: small, so the plot sits in the note like a figure; 2D axes grow them to fit their labels (automargin). */
const MARGIN = 8;
const TITLE_MARGIN = 32;
const TITLE_SIZE = 14;

/**
 * The figure of `spec` in `theme`; a 3D spec's surfaces and meshes in `style` (as a plain surface when their wireframe is over
 * the cap) and coloured by `colour`.
 */
export function toPlotlyFigure(spec: PlotSpec, theme: PlotTheme, style: PlotSurfaceStyle = "surface", colour: PlotSurfaceColour = "single"): PlotlyFigure {
  const surfaces = hasPlotSurfaces(spec);
  const wires = style !== "surface" && surfaces ? plotWires(spec, style === "both" ? sceneScale(spec) : null) : null;
  const height = colour === "height" && surfaces ? heightRange(spec) : null;
  const lineColour = overlayColour(theme);
  const overlays: object[] = [];
  const data = spec.traces.map((trace, i) => {
    const color = trace.color ?? theme.palette[i % theme.palette.length]!;
    const wire = wires?.get(i);
    if (wire && style === "wireframe") return wireTrace(trace, wire, color, height);
    if (wire) overlays.push(overlayTrace(wire, lineColour));
    return toTrace(trace, color, spec.dim, height);
  });
  data.push(...overlays);
  const flat = spec.dim !== 3;
  const xTitle = flat && spec.axes.x?.label !== undefined;
  const yTitle = flat && spec.axes.y?.label !== undefined;
  // The top band holds the title on the left and the output's plot buttons on the right, clear of the data; a y title sits under the title.
  const top = TITLE_MARGIN + (yTitle && spec.title !== undefined ? Y_TITLE_ROOM : 0);
  const layout: Record<string, unknown> = {
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { color: theme.text, family: theme.font },
    margin: { l: MARGIN, r: MARGIN, t: top, b: xTitle ? X_TITLE_ROOM : MARGIN, pad: 0 },
    showlegend: spec.traces.some((t) => t.name !== undefined),
    legend: { font: { family: theme.font, size: AXIS_TEXT_SIZE, color: theme.muted } },
    hovermode: "closest",
    uirevision: "labshelf",
  };
  if (spec.title !== undefined) layout.title = {
    text: spec.title, x: 0, xref: "container", xanchor: "left", y: 1, yref: "container", yanchor: "top", pad: { t: MARGIN, l: MARGIN },
    font: { family: theme.font, size: TITLE_SIZE, color: theme.text, weight: "normal" },
  };
  if (spec.dim === 3) {
    layout.scene = {
      xaxis: toSceneAxis(spec.axes.x, theme),
      yaxis: toSceneAxis(spec.axes.y, theme),
      zaxis: toSceneAxis(spec.axes.z, theme),
      dragmode: "turntable",
    };
  } else {
    layout.xaxis = { ...toAxis(spec.axes.x, theme), automargin: true };
    layout.yaxis = { ...toAxis(spec.axes.y, theme), automargin: true };
    layout.annotations = axisTitles(spec, theme);
    layout.dragmode = "pan";
  }
  // The modebar is replaced by the output's own buttons, and the wheel and double-click by its own navigation
  // (outputPlot.ts, plotNavigation.ts): Plotly's scroll zoom would capture every wheel over the plot in a scrolling note.
  return { data, layout, config: { displaylogo: false, responsive: true, displayModeBar: false, scrollZoom: false, doubleClick: false } };
}
