// Draws a labshelf-plot spec with plotly.js: the lazy bundle loader and the spec-to-figure mapping with the page theme's
// colours; the plot handle that updates in place and redraws on a theme change is in plotRender.ts.
import type { PlotAxis, PlotSpec, PlotTrace } from "../item/index.js";

/** The part of the plotly.js API core calls. */
export interface PlotlyApi {
  react(root: HTMLElement, data: readonly object[], layout?: object, config?: object): Promise<unknown>;
  purge(root: HTMLElement): void;
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

export interface PlotTheme { text: string; grid: string; font: string; palette: string[] }

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
    grid: read("--ls-border-soft") || "rgba(128, 128, 128, .2)",
    font: read("--ls-font") || "sans-serif",
    palette: palette.length > 0 ? palette : [...DEFAULT_PLOT_PALETTE],
  };
}

export function sameTheme(a: PlotTheme, b: PlotTheme): boolean {
  return a.text === b.text && a.grid === b.grid && a.font === b.font
    && a.palette.length === b.palette.length && a.palette.every((colour, i) => colour === b.palette[i]);
}

export interface PlotlyFigure { data: object[]; layout: object; config: object }

function toTrace(trace: PlotTrace, color: string, dim: 2 | 3): object {
  const named = trace.name !== undefined ? { name: trace.name } : {};
  switch (trace.type) {
    case "line":
    case "points": {
      const style = trace.type === "line" ? { mode: "lines", line: { color } } : { mode: "markers", marker: { color } };
      return dim === 3
        ? { type: "scatter3d", ...named, x: trace.x, y: trace.y, z: trace.z, ...style }
        : { type: "scatter", ...named, x: trace.x, y: trace.y, ...style };
    }
    case "surface":
      return { type: "surface", ...named, x: trace.x, y: trace.y, z: trace.z, showscale: false, colorscale: [[0, color], [1, color]] };
    case "mesh":
      return {
        type: "mesh3d",
        ...named,
        x: trace.vertices.map((v) => v[0]),
        y: trace.vertices.map((v) => v[1]),
        z: trace.vertices.map((v) => v[2]),
        i: trace.faces.map((f) => f[0]),
        j: trace.faces.map((f) => f[1]),
        k: trace.faces.map((f) => f[2]),
        color,
      };
  }
}

function toAxis(axis: PlotAxis | undefined, theme: PlotTheme): object {
  const log = axis?.log === true;
  const out: Record<string, unknown> = {};
  if (axis?.label !== undefined) out.title = { text: axis.label };
  out.type = log ? "log" : "linear";
  out.gridcolor = theme.grid;
  out.zerolinecolor = theme.grid;
  out.color = theme.text;
  if (axis?.range) out.range = log ? [Math.log10(axis.range[0]), Math.log10(axis.range[1])] : [...axis.range];
  return out;
}

export function toPlotlyFigure(spec: PlotSpec, theme: PlotTheme): PlotlyFigure {
  const data = spec.traces.map((trace, i) =>
    toTrace(trace, trace.color ?? theme.palette[i % theme.palette.length]!, spec.dim));
  const layout: Record<string, unknown> = {
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { color: theme.text, family: theme.font },
    showlegend: spec.traces.some((t) => t.name !== undefined),
    hovermode: "closest",
    uirevision: "labshelf",
  };
  if (spec.title !== undefined) layout.title = { text: spec.title };
  if (spec.dim === 3) {
    layout.scene = {
      xaxis: toAxis(spec.axes.x, theme),
      yaxis: toAxis(spec.axes.y, theme),
      zaxis: toAxis(spec.axes.z, theme),
    };
  } else {
    layout.xaxis = toAxis(spec.axes.x, theme);
    layout.yaxis = toAxis(spec.axes.y, theme);
  }
  return { data, layout, config: { displaylogo: false, responsive: true } };
}
