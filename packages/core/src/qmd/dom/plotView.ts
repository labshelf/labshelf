// Draws a labshelf-plot spec with plotly.js: the lazy bundle loader, the spec-to-figure mapping with the page theme's
// colours, and a plot handle that updates in place (latest wins) and redraws when the page theme changes.
import type { PlotAxis, PlotSpec, PlotTrace } from "../plot/index.js";

type PlotlyApi = import("../plot/plotly.js").PlotlyApi;

export type PlotlyLoader = () => Promise<import("../plot/plotly.js").PlotlyApi>;

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
 * Loads the plotly bundle once per page, after pre-creating the style elements it looks up.
 * TRAP: it is about 5 MB of minified UMD with import-time side effects; only ever import it lazily, never statically.
 */
export const loadCorePlotly: PlotlyLoader = () => {
  if (!plotlyLoad) {
    preparePlotlyStyles(document);
    plotlyLoad = import("../plot/plotly.js").then(
      (mod) => mod.Plotly,
      (error: unknown) => {
        plotlyLoad = null;
        throw error;
      },
    );
  }
  return plotlyLoad;
};

export interface PlotTheme { text: string; grid: string; font: string; palette: string[] }

export const DEFAULT_PLOT_PALETTE: readonly string[] = [
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

function sameTheme(a: PlotTheme, b: PlotTheme): boolean {
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

export function toPlotlyFigure(spec: import("../plot/index.js").PlotSpec, theme: PlotTheme): PlotlyFigure {
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

export interface PlotHandle { readonly drawn: Promise<void>; update(spec: import("../plot/index.js").PlotSpec): Promise<void>; destroy(): void }

/** One shared theme watcher for every live plot: created with the first, disconnected with the last. */
const themeListeners = new Set<() => void>();
let stopThemeWatch: (() => void) | null = null;

function notifyTheme(): void {
  for (const listener of [...themeListeners]) listener();
}

function watchTheme(listener: () => void): void {
  themeListeners.add(listener);
  if (stopThemeWatch) return;
  const observer = new MutationObserver(notifyTheme);
  const options: MutationObserverInit = { attributes: true, attributeFilter: ["class", "data-theme", "style"] };
  observer.observe(document.documentElement, options);
  if (document.body) observer.observe(document.body, options);
  const media = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  media?.addEventListener("change", notifyTheme);
  stopThemeWatch = () => {
    observer.disconnect();
    media?.removeEventListener("change", notifyTheme);
  };
}

function unwatchTheme(listener: () => void): void {
  if (!themeListeners.delete(listener) || themeListeners.size > 0 || !stopThemeWatch) return;
  stopThemeWatch();
  stopThemeWatch = null;
}

interface Waiter { resolve(): void; reject(error: unknown): void }

export function renderPlot(root: HTMLElement, spec: import("../plot/index.js").PlotSpec, loadPlotly: PlotlyLoader): PlotHandle {
  let plotly: PlotlyApi | null = null;
  let destroyed = false;
  let busy = false;
  let firstDone = false;
  let current: PlotSpec = spec;
  let lastTheme: PlotTheme | null = null;
  /** The latest spec not yet handed to react, and every caller waiting on it or an earlier dropped one. */
  let next: PlotSpec | null = spec;
  let waiters: Waiter[] = [];
  let themeDirty = false;
  let loadFailed: { error: unknown } | null = null;

  let resolveDrawn!: () => void;
  let rejectDrawn!: (error: unknown) => void;
  const drawn = new Promise<void>((resolve, reject) => { resolveDrawn = resolve; rejectDrawn = reject; });
  drawn.catch(() => undefined);

  const settle = (list: Waiter[], error?: unknown): void => {
    for (const waiter of list) {
      if (error === undefined) waiter.resolve();
      else waiter.reject(error);
    }
  };

  const pump = (): void => {
    if (destroyed || busy || !plotly) return;
    let target: PlotSpec;
    let theme: PlotTheme;
    if (next) {
      target = next;
      theme = readPlotTheme(root);
    } else if (themeDirty) {
      themeDirty = false;
      theme = readPlotTheme(root);
      if (lastTheme && sameTheme(theme, lastTheme)) return;
      target = current;
    } else {
      return;
    }
    const batch = waiters;
    next = null;
    waiters = [];
    themeDirty = false;
    current = target;
    lastTheme = theme;
    busy = true;
    const figure = toPlotlyFigure(target, theme);
    const api = plotly;
    let call: Promise<unknown>;
    try {
      call = api.react(root, figure.data, figure.layout, figure.config);
    } catch (error) {
      call = Promise.reject(error);
    }
    call.then(
      () => {
        busy = false;
        if (!firstDone) { firstDone = true; resolveDrawn(); }
        settle(batch);
        pump();
      },
      (error: unknown) => {
        busy = false;
        if (!firstDone) { firstDone = true; rejectDrawn(error); }
        settle(batch, error);
        pump();
      },
    );
  };

  const onTheme = (): void => {
    if (destroyed || !firstDone) return;
    themeDirty = true;
    pump();
  };

  watchTheme(onTheme);

  loadPlotly().then(
    (api) => {
      if (destroyed) return;
      plotly = api;
      pump();
    },
    (error: unknown) => {
      if (destroyed) return;
      loadFailed = { error };
      firstDone = true;
      rejectDrawn(error);
      const batch = waiters;
      waiters = [];
      next = null;
      settle(batch, error);
      unwatchTheme(onTheme);
    },
  );

  return {
    drawn,
    update(nextSpec: PlotSpec): Promise<void> {
      if (destroyed) return Promise.resolve();
      if (loadFailed) return Promise.reject(loadFailed.error);
      return new Promise<void>((resolve, reject) => {
        next = nextSpec;
        waiters.push({ resolve, reject });
        pump();
      });
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      unwatchTheme(onTheme);
      const batch = waiters;
      waiters = [];
      next = null;
      settle(batch);
      if (!firstDone) resolveDrawn();
      if (plotly) plotly.purge(root);
    },
  };
}
