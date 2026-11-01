// The plot handle: draws a labshelf-plot spec into an element, updates it in place (latest wins), redraws when the page theme
// changes and shows its own hover card for the point under the pointer.
import { renderElement } from "../../ui/dom/index.js";
import type { PlotSpec } from "../item/index.js";
import {
  hasPlotSurfaces, PLOT_AUTOSCALE, plotDragModeUpdate, plotResetView, plotWireframeFits, readPlotTheme, type PlotDragMode, sameTheme, toPlotlyFigure,
  type PlotSurfaceColour, type PlotSurfaceStyle, type PlotTheme, type PlotlyApi, type PlotlyFigure, type PlotlyLoader,
} from "./plotView.js";

export interface PlotHandle {
  readonly drawn: Promise<void>;
  update(spec: PlotSpec): Promise<void>;
  /** The dimensions of the spec last drawn (the first spec before a draw). */
  readonly dim: 2 | 3;
  /** Returns the drawn plot to its first view; does nothing before Plotly loads or after destroy. */
  resetView(): Promise<void>;
  /** Fits both axes of a drawn 2D plot to its data, ignoring the spec's ranges; does nothing in 3D, before Plotly loads or after destroy. */
  autoscale(): Promise<void>;
  /** Applies a relayout update to the drawn plot; does nothing before Plotly loads or after destroy. */
  relayout(update: Record<string, unknown>): Promise<void>;
  /** Sets what a drag does on the drawn plot; does nothing before Plotly loads or after destroy. */
  setDragMode(mode: PlotDragMode): Promise<void>;
  /** How the spec's 3D surfaces and meshes are drawn; "surface" until the user picks otherwise. */
  readonly surfaceStyle: PlotSurfaceStyle;
  /** True when the spec last drawn is 3D with a surface or mesh trace, so a surface style applies. */
  readonly hasSurfaces: boolean;
  /** True when the spec's surfaces fit a wireframe (under PLOT_WIREFRAME_SEGMENTS edges). */
  readonly wireframeFits: boolean;
  /** Redraws the surfaces in `style`, keeping the view; every handle sharing the style key follows. */
  setSurfaceStyle(style: PlotSurfaceStyle): Promise<void>;
  /** How the spec's 3D surfaces and meshes are coloured; "single" until the user picks otherwise. */
  readonly surfaceColour: PlotSurfaceColour;
  /** Redraws the surfaces coloured by `colour`, keeping the view; every handle sharing the style key follows. */
  setSurfaceColour(colour: PlotSurfaceColour): Promise<void>;
  /** Downloads the drawn plot as `<filename>.png`; does nothing before Plotly loads or after destroy. */
  downloadPng(filename: string): Promise<void>;
  destroy(): void;
}

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

export interface RenderPlotOptions {
  /**
   * Keys the surface style and colour the user picks, for the session: handles with the same key (an output's inline plot, its slider
   * previews and its expand overlay) share them. Without a key they live with the handle. It is never written to the file.
   */
  styleKey?: string | undefined;
}

/** How a plot draws and colours its 3D surfaces. */
interface SurfaceLook { style: PlotSurfaceStyle; colour: PlotSurfaceColour }

const DEFAULT_LOOK: SurfaceLook = { style: "surface", colour: "single" };

/** The surface look picked per style key, and the redraw of each live handle with that key. */
const surfaceLooks = new Map<string, SurfaceLook>();
const styleListeners = new Map<string, Set<() => void>>();

interface Waiter { resolve(): void; reject(error: unknown): void }

/** The live state of one plot handle. */
interface PlotState {
  readonly root: HTMLElement;
  plotly: PlotlyApi | null;
  destroyed: boolean;
  busy: boolean;
  firstDone: boolean;
  current: PlotSpec;
  lastTheme: PlotTheme | null;
  /** The latest spec not yet handed to react, and every caller waiting on it or an earlier dropped one. */
  next: PlotSpec | null;
  waiters: Waiter[];
  themeDirty: boolean;
  readonly styleKey: string | null;
  /** The look of a handle without a key. */
  ownLook: SurfaceLook;
  /** The look the last react drew. */
  lastLook: SurfaceLook | null;
  loadFailed: { error: unknown } | null;
  /** Removes the hover card and its listeners; set once the first draw succeeds. */
  stopTooltip: (() => void) | null;
  resolveDrawn(): void;
  rejectDrawn(error: unknown): void;
  readonly onTheme: () => void;
  readonly onStyle: () => void;
}

function settle(list: Waiter[], error?: unknown): void {
  for (const waiter of list) {
    if (error === undefined) waiter.resolve();
    else waiter.reject(error);
  }
}

/** Empties the queue: drops the pending spec and returns the callers that waited on it. */
function takeWaiters(state: PlotState): Waiter[] {
  const batch = state.waiters;
  state.waiters = [];
  state.next = null;
  return batch;
}

function lookOf(state: PlotState): SurfaceLook {
  return state.styleKey !== null ? surfaceLooks.get(state.styleKey) ?? DEFAULT_LOOK : state.ownLook;
}

/** Stores `change` in the handle's look (its key's, shared, or its own) and redraws every handle that shows it. */
function changeLook(state: PlotState, change: Partial<SurfaceLook>): Promise<void> {
  if (state.destroyed) return Promise.resolve();
  if (state.loadFailed) return Promise.reject(state.loadFailed.error);
  const look = { ...lookOf(state), ...change };
  if (state.styleKey === null) {
    state.ownLook = look;
    pump(state);
    return Promise.resolve();
  }
  surfaceLooks.set(state.styleKey, look);
  for (const listener of [...styleListeners.get(state.styleKey) ?? []]) listener();
  return Promise.resolve();
}

/** The spec and theme to draw next: the queued spec, else the current one when the theme or style changed; null when nothing to do. */
function pickTarget(state: PlotState): { target: PlotSpec; theme: PlotTheme } | null {
  if (state.next) return { target: state.next, theme: readPlotTheme(state.root) };
  const look = lookOf(state);
  if (state.lastLook !== null && (state.lastLook.style !== look.style || state.lastLook.colour !== look.colour)) {
    state.themeDirty = false;
    return { target: state.current, theme: readPlotTheme(state.root) };
  }
  if (!state.themeDirty) return null;
  state.themeDirty = false;
  const theme = readPlotTheme(state.root);
  if (state.lastTheme && sameTheme(theme, state.lastTheme)) return null;
  return { target: state.current, theme };
}

/** Calls react, turning a synchronous throw into a rejected promise. */
function callReact(api: PlotlyApi, root: HTMLElement, figure: PlotlyFigure): Promise<unknown> {
  try {
    return api.react(root, figure.data, figure.layout, figure.config);
  } catch (error) {
    return Promise.reject(error);
  }
}

/** Ends one react call: settles the first draw and the batch, then draws whatever queued meanwhile. */
function finishDraw(state: PlotState, batch: Waiter[], failure: { error: unknown } | null): void {
  state.busy = false;
  if (!failure && !state.stopTooltip && !state.destroyed) state.stopTooltip = attachPlotTooltip(state);
  if (!state.firstDone) {
    state.firstDone = true;
    if (failure) state.rejectDrawn(failure.error);
    else state.resolveDrawn();
  }
  settle(batch, failure?.error);
  pump(state);
}

function pump(state: PlotState): void {
  if (state.destroyed || state.busy || !state.plotly) return;
  const picked = pickTarget(state);
  if (!picked) return;
  const batch = takeWaiters(state);
  state.themeDirty = false;
  state.current = picked.target;
  state.lastTheme = picked.theme;
  const look = lookOf(state);
  state.lastLook = look;
  state.busy = true;
  callReact(state.plotly, state.root, toPlotlyFigure(picked.target, picked.theme, look.style, look.colour)).then(
    () => finishDraw(state, batch, null),
    (error: unknown) => finishDraw(state, batch, { error }),
  );
}

function failLoad(state: PlotState, error: unknown): void {
  if (state.destroyed) return;
  state.loadFailed = { error };
  state.firstDone = true;
  state.rejectDrawn(error);
  settle(takeWaiters(state), error);
  unwatchTheme(state.onTheme);
  unwatchStyle(state);
}

function watchStyle(state: PlotState): void {
  if (state.styleKey === null) return;
  let set = styleListeners.get(state.styleKey);
  if (!set) styleListeners.set(state.styleKey, set = new Set());
  set.add(state.onStyle);
}

function unwatchStyle(state: PlotState): void {
  if (state.styleKey === null) return;
  const set = styleListeners.get(state.styleKey);
  set?.delete(state.onStyle);
  if (set?.size === 0) styleListeners.delete(state.styleKey);
}

/** One point of a Plotly hover event; `bbox` (viewport px) comes with 2D points only. */
interface HoverPoint { x?: unknown; y?: unknown; z?: unknown; curveNumber?: unknown; bbox?: { x0: number; x1: number; y0: number; y1: number } }

/** The event part of the root Plotly decorates after its first draw. */
interface PlotEvents {
  on(name: string, listener: (data: unknown) => void): void;
  removeListener?(name: string, listener: (data: unknown) => void): void;
}

/** A hover value at 4 significant digits with a true minus sign; text values as they are. */
function formatHoverValue(value: unknown): string {
  if (typeof value !== "number") return String(value ?? "");
  if (!Number.isFinite(value)) return String(value);
  return String(Number(value.toPrecision(4))).replaceAll("-", "\u2212");
}

/** The px between the hovered point and its card. */
const TOOLTIP_GAP = 12;
/** How long an unhover waits for the next hover before the card hides, so moving between points does not flicker. */
const TOOLTIP_HIDE_MS = 80;

/**
 * Shows a small card for the hovered point in place of Plotly's hover label (the figure sets hoverinfo "none"): the trace's colour
 * and name when it has one or the plot has several traces, then a row per axis named by its title. The card sits beside the point
 * inside the root, flipping near the edges; it never takes pointer events and hides on unhover, leave, press, wheel and scroll.
 */
function attachPlotTooltip(state: PlotState): (() => void) | null {
  const root = state.root;
  const events = root as HTMLElement & Partial<PlotEvents>;
  if (typeof events.on !== "function") return null;
  const doc = root.ownerDocument;
  const win = doc.defaultView ?? window;
  let card: HTMLElement | null = null;
  let hideTimer = 0;
  let pointer: { x: number; y: number } | null = null;

  const hide = (): void => {
    win.clearTimeout(hideTimer);
    card?.classList.remove("is-shown");
  };
  const show = (data: unknown): void => {
    const point = (data as { points?: HoverPoint[] } | null)?.points?.[0];
    if (!point) return;
    win.clearTimeout(hideTimer);
    const spec = state.current;
    const index = typeof point.curveNumber === "number" ? point.curveNumber : 0;
    const trace = spec.traces[index];
    const palette = state.lastTheme?.palette ?? [];
    const colour = trace?.color ?? palette[index % Math.max(1, palette.length)] ?? "currentColor";
    const rows: HTMLElement[] = [];
    if (trace && (spec.traces.length > 1 || trace.name !== undefined)) {
      const dot = renderElement("span", { class: "qmd-plot-tooltip-dot" });
      dot.style.setProperty("--qmd-plot-tooltip-colour", colour);
      rows.push(renderElement("div", { class: "qmd-plot-tooltip-name" }, dot, renderElement("span", {}, trace.name ?? `Trace ${index + 1}`)));
    }
    const names = spec.dim === 3 ? (["x", "y", "z"] as const) : (["x", "y"] as const);
    for (const name of names) {
      rows.push(renderElement("div", { class: "qmd-plot-tooltip-row" },
        renderElement("span", { class: "qmd-plot-tooltip-label" }, spec.axes[name]?.label ?? name),
        renderElement("span", { class: "qmd-plot-tooltip-value" }, formatHoverValue(point[name]))));
    }
    if (!card) {
      card = renderElement("div", { class: "qmd-plot-tooltip", "aria-hidden": "true" });
      root.append(card);
    }
    card.replaceChildren(...rows);
    const rect = root.getBoundingClientRect();
    const box = point.bbox;
    const at = box ? { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 } : pointer;
    if (!at) return;
    const ax = at.x - rect.left;
    const ay = at.y - rect.top;
    const w = card.offsetWidth;
    const h = card.offsetHeight;
    let left = ax + TOOLTIP_GAP;
    if (left + w > rect.width) left = ax - TOOLTIP_GAP - w;
    let top = ay - TOOLTIP_GAP - h;
    if (top < 0) top = ay + TOOLTIP_GAP;
    left = Math.max(0, Math.min(left, rect.width - w));
    top = Math.max(0, Math.min(top, rect.height - h));
    card.style.setProperty("left", `${Math.round(left)}px`);
    card.style.setProperty("top", `${Math.round(top)}px`);
    card.classList.add("is-shown");
  };
  const unhover = (): void => {
    win.clearTimeout(hideTimer);
    hideTimer = win.setTimeout(hide, TOOLTIP_HIDE_MS);
  };
  const onMove = (event: PointerEvent): void => { pointer = { x: event.clientX, y: event.clientY }; };
  events.on("plotly_hover", show);
  events.on("plotly_unhover", unhover);
  root.addEventListener("pointermove", onMove, true);
  root.addEventListener("pointerleave", hide);
  root.addEventListener("pointerdown", hide, true);
  root.addEventListener("wheel", hide, { capture: true, passive: true });
  win.addEventListener("scroll", hide, { capture: true, passive: true });
  return () => {
    win.clearTimeout(hideTimer);
    events.removeListener?.("plotly_hover", show);
    events.removeListener?.("plotly_unhover", unhover);
    root.removeEventListener("pointermove", onMove, true);
    root.removeEventListener("pointerleave", hide);
    root.removeEventListener("pointerdown", hide, true);
    root.removeEventListener("wheel", hide, { capture: true });
    win.removeEventListener("scroll", hide, { capture: true });
    card?.remove();
    card = null;
  };
}

function plotHandle(state: PlotState, drawn: Promise<void>): PlotHandle {
  return {
    drawn,
    update(nextSpec: PlotSpec): Promise<void> {
      if (state.destroyed) return Promise.resolve();
      if (state.loadFailed) return Promise.reject(state.loadFailed.error);
      return new Promise<void>((resolve, reject) => {
        state.next = nextSpec;
        state.waiters.push({ resolve, reject });
        pump(state);
      });
    },
    async resetView(): Promise<void> {
      if (state.destroyed || !state.plotly || !state.firstDone) return;
      await state.plotly.relayout(state.root, plotResetView(state.current));
    },
    get dim() { return state.current.dim; },
    async autoscale(): Promise<void> {
      if (state.destroyed || !state.plotly || !state.firstDone || state.current.dim !== 2) return;
      await state.plotly.relayout(state.root, { ...PLOT_AUTOSCALE });
    },
    async relayout(update: Record<string, unknown>): Promise<void> {
      if (state.destroyed || !state.plotly || !state.firstDone) return;
      await state.plotly.relayout(state.root, update);
    },
    async setDragMode(mode: PlotDragMode): Promise<void> {
      if (state.destroyed || !state.plotly || !state.firstDone) return;
      await state.plotly.relayout(state.root, plotDragModeUpdate(state.current.dim, mode));
    },
    get surfaceStyle() { return lookOf(state).style; },
    get hasSurfaces() { return hasPlotSurfaces(state.current); },
    get wireframeFits() { return plotWireframeFits(state.current); },
    setSurfaceStyle(style: PlotSurfaceStyle): Promise<void> { return changeLook(state, { style }); },
    get surfaceColour() { return lookOf(state).colour; },
    setSurfaceColour(colour: PlotSurfaceColour): Promise<void> { return changeLook(state, { colour }); },
    async downloadPng(filename: string): Promise<void> {
      if (state.destroyed || !state.plotly || !state.firstDone) return;
      await state.plotly.downloadImage(state.root, { format: "png", filename });
    },
    destroy(): void {
      if (state.destroyed) return;
      state.destroyed = true;
      unwatchTheme(state.onTheme);
      unwatchStyle(state);
      state.stopTooltip?.();
      state.stopTooltip = null;
      settle(takeWaiters(state));
      if (!state.firstDone) state.resolveDrawn();
      if (state.plotly) state.plotly.purge(state.root);
    },
  };
}

export function renderPlot(root: HTMLElement, spec: PlotSpec, loadPlotly: PlotlyLoader, options: RenderPlotOptions = {}): PlotHandle {
  let resolveDrawn!: () => void;
  let rejectDrawn!: (error: unknown) => void;
  const drawn = new Promise<void>((resolve, reject) => { resolveDrawn = resolve; rejectDrawn = reject; });
  drawn.catch(() => undefined);
  const state: PlotState = {
    root, plotly: null, destroyed: false, busy: false, firstDone: false, current: spec, lastTheme: null, next: spec,
    waiters: [], themeDirty: false, styleKey: options.styleKey || null, ownLook: DEFAULT_LOOK, lastLook: null, loadFailed: null, stopTooltip: null, resolveDrawn, rejectDrawn,
    onTheme: () => {
      if (state.destroyed || !state.firstDone) return;
      state.themeDirty = true;
      pump(state);
    },
    onStyle: () => {
      if (state.destroyed || !state.firstDone) return;
      pump(state);
    },
  };
  watchTheme(state.onTheme);
  watchStyle(state);
  loadPlotly().then(
    (api) => {
      if (state.destroyed) return;
      state.plotly = api;
      pump(state);
    },
    (error: unknown) => failLoad(state, error),
  );
  return plotHandle(state, drawn);
}
