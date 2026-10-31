// The plot handle: draws a labshelf-plot spec into an element, updates it in place (latest wins) and redraws when the page theme changes.
import type { PlotSpec } from "../item/index.js";
import {
  readPlotTheme, sameTheme, toPlotlyFigure, type PlotTheme, type PlotlyApi, type PlotlyFigure, type PlotlyLoader,
} from "./plotView.js";

export interface PlotHandle { readonly drawn: Promise<void>; update(spec: PlotSpec): Promise<void>; destroy(): void }

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
  loadFailed: { error: unknown } | null;
  resolveDrawn(): void;
  rejectDrawn(error: unknown): void;
  readonly onTheme: () => void;
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

/** The spec and theme to draw next: the queued spec, else the current one when the theme changed; null when nothing to do. */
function pickTarget(state: PlotState): { target: PlotSpec; theme: PlotTheme } | null {
  if (state.next) return { target: state.next, theme: readPlotTheme(state.root) };
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
  state.busy = true;
  callReact(state.plotly, state.root, toPlotlyFigure(picked.target, picked.theme)).then(
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
    destroy(): void {
      if (state.destroyed) return;
      state.destroyed = true;
      unwatchTheme(state.onTheme);
      settle(takeWaiters(state));
      if (!state.firstDone) state.resolveDrawn();
      if (state.plotly) state.plotly.purge(state.root);
    },
  };
}

export function renderPlot(root: HTMLElement, spec: PlotSpec, loadPlotly: PlotlyLoader): PlotHandle {
  let resolveDrawn!: () => void;
  let rejectDrawn!: (error: unknown) => void;
  const drawn = new Promise<void>((resolve, reject) => { resolveDrawn = resolve; rejectDrawn = reject; });
  drawn.catch(() => undefined);
  const state: PlotState = {
    root, plotly: null, destroyed: false, busy: false, firstDone: false, current: spec, lastTheme: null, next: spec,
    waiters: [], themeDirty: false, loadFailed: null, resolveDrawn, rejectDrawn,
    onTheme: () => {
      if (state.destroyed || !state.firstDone) return;
      state.themeDirty = true;
      pump(state);
    },
  };
  watchTheme(state.onTheme);
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
