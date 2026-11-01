// The plot handle: draws a labshelf-plot spec into an element, updates it in place (latest wins), redraws when the page theme
// changes and shows its own hover card for the point under the pointer.
import type { PlotSpec } from "../item/index.js";
import { attachPlotTooltip } from "./plotTooltip.js";
import {
  readPlotTheme, sameTheme, toPlotlyFigure,
  type PlotSurfaceColour, type PlotSurfaceStyle, type PlotTheme, type PlotlyApi, type PlotlyFigure, type PlotlyLoader,
} from "./plotView.js";
import { hasPlotSurfaces, plotWireframeFits } from "./plotSurfaceWires.js";
import { PLOT_AUTOSCALE, plotDragModeUpdate, plotResetView, type PlotDragMode } from "./plotViewState.js";

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

/** Applies a relayout update to the drawn plot; does nothing before Plotly loads or after destroy. */
async function relayoutDrawn(state: PlotState, update: Record<string, unknown>): Promise<void> {
  if (state.destroyed || !state.plotly || !state.firstDone) return;
  await state.plotly.relayout(state.root, update);
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
    resetView: () => relayoutDrawn(state, plotResetView(state.current)),
    get dim() { return state.current.dim; },
    autoscale: () => state.current.dim === 2 ? relayoutDrawn(state, { ...PLOT_AUTOSCALE }) : Promise.resolve(),
    relayout: (update: Record<string, unknown>) => relayoutDrawn(state, update),
    setDragMode: (mode: PlotDragMode) => relayoutDrawn(state, plotDragModeUpdate(state.current.dim, mode)),
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
