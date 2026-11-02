// Draws a labshelf-plot spec with plotly.js: the lazy bundle loader and the spec-to-figure mapping with the page theme's
// colours; the plot handle that updates in place and redraws on a theme change is in plotRender.ts.
import type { PlotAxis, PlotSpec, PlotTrace, PlotValue } from "../item/index.js";
import { heightRange, hasPlotSurfaces, plotWires, sceneScale, type Wire } from "./plotSurfaceWires.js";
import type { EditorPlotly } from "./chartEditor/editorPlotly.js";
import { axisRange } from "./plotViewState.js";

export { plotResetView } from "./plotViewState.js";

/** The part of the plotly.js API core calls. */
export interface PlotlyApi extends EditorPlotly {
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


/** The px width of a wireframe's lines, and of the grid lines drawn over a surface. */
const WIRE_WIDTH = 1.25;
const OVERLAY_WIDTH = 1;
/** The opacity of the grid lines drawn over a surface. */
const OVERLAY_ALPHA = 0.55;

type Rgb = [number, number, number];

/** The red, green and blue of a `#rgb`, `#rrggbb(aa)` or `rgb(a)()` colour, or null for any other form. */
function rgbOf(colour: string): Rgb | null {
  const hex = /^#([0-9a-f]{3,8})$/i.exec(colour.trim())?.[1];
  if (hex && (hex.length === 3 || hex.length === 6 || hex.length === 8)) {
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex.slice(0, 6);
    return [0, 2, 4].map((n) => parseInt(full.slice(n, n + 2), 16)) as Rgb;
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(colour.trim());
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
}

/** The colour of the grid lines drawn over a surface: the darker of the theme's text and ground (the ground on a dark theme, the text on a light one), part transparent. */
function overlayColour(theme: PlotTheme): string {
  const light = (rgb: Rgb): number => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  const dark = [theme.text, theme.bg].map(rgbOf).filter((rgb): rgb is Rgb => rgb !== null).sort((a, b) => light(a) - light(b))[0] ?? [0, 0, 0];
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
