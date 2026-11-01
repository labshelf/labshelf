// Shared helpers for the plot view tests: a fake PlotlyApi, figure views, deferreds, specs and matchMedia stubs.
import type { PlotSpec } from "../../../src/qmd/item/plotSpec";
import type { PlotTheme } from "../../../src/qmd/dom/plotView";

/** The part of the plotly.js API the plot view calls (declared here: the module's own type export is a seam of another file). */
export interface PlotlyApi {
  react(root: HTMLElement, data: readonly object[], layout?: object, config?: object): Promise<unknown>;
  purge(root: HTMLElement): void;
  relayout(root: HTMLElement, update: object): Promise<unknown>;
  downloadImage(root: HTMLElement, options: { format: "png"; filename: string }): Promise<unknown>;
  Plots: { resize(root: HTMLElement): unknown };
}

/** The two style ids Plotly looks up (decided item 1). */
export const STYLE_IDS: readonly string[] = ["plotly.js-style-global", "9f215cf04c5486422605d13261cb87401f4e7763b6296af81e98efbc0130da53"];

/** The ten default plot colours (decided item 4). */
export const DEFAULT_PALETTE: readonly string[] = [
  "#4e79a7", "#f28e2b", "#e15759", "#76b7b2", "#59a14f", "#edc948", "#b07aa1", "#ff9da7", "#9c755f", "#bab0ac",
];

/** Local typed views over the parts of a figure the tests read. */
export interface AxisView {
  title?: { text?: string };
  type?: string;
  range?: number[];
  gridcolor?: string;
  zerolinecolor?: string;
  zeroline?: boolean;
  showbackground?: boolean;
  color?: string;
  automargin?: boolean;
  showline?: boolean;
  linecolor?: string;
  linewidth?: number;
}

export interface LayoutView {
  title?: { text?: string; font?: { family?: string; size?: number } };
  margin?: { l: number; r: number; t: number; b: number };
  hoverlabel?: object;
  dragmode?: string;
  showlegend?: boolean;
  xaxis?: AxisView;
  yaxis?: AxisView;
  scene?: { xaxis: AxisView; yaxis: AxisView; zaxis: AxisView; dragmode?: string };
  paper_bgcolor?: string;
  plot_bgcolor?: string;
  font?: { color?: string; family?: string };
  uirevision?: string;
  hovermode?: string;
}

export interface TraceView {
  name?: string;
  y?: unknown;
  color?: string;
  colorscale?: unknown;
  line?: { color?: string };
  marker?: { color?: string };
}

export function layoutOf(fig: { layout: object }): LayoutView {
  return fig.layout as LayoutView;
}

export function tracesOf(fig: { data: readonly object[] }): TraceView[] {
  return fig.data as TraceView[];
}

/** An axis that must exist, as the test then reads fields of it. */
export function axisOf(axis: AxisView | undefined): AxisView {
  if (!axis) throw new Error("axis is missing");
  return axis;
}

/** window.matchMedia as it stood before any test (jsdom has none). */
export const originalMatchMedia: typeof window.matchMedia | undefined = window.matchMedia;

/** Installs a matchMedia whose lists record their listeners on the given mocks; returns the matchMedia mock. */
export function installMatchMedia(add: jest.Mock, remove: jest.Mock): jest.Mock {
  const mm = jest.fn(() => ({ matches: false, addEventListener: add, removeEventListener: remove }));
  Object.defineProperty(window, "matchMedia", { value: mm as unknown as typeof window.matchMedia, configurable: true, writable: true });
  return mm;
}

export function restoreMatchMedia(): void {
  if (originalMatchMedia === undefined) Reflect.deleteProperty(window, "matchMedia");
  else Object.defineProperty(window, "matchMedia", { value: originalMatchMedia, configurable: true, writable: true });
}

export interface Deferred<T> { promise: Promise<T>; resolve(v: T): void; reject(e: unknown): void }

export function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}

/** Lets pending promise callbacks and mutation observer callbacks run. */
export async function flush(): Promise<void> {
  for (let n = 0; n < 3; n++) await new Promise<void>((r) => setTimeout(r, 0));
}

export interface Fake {
  api: PlotlyApi;
  react: jest.Mock;
  purge: jest.Mock;
  resize: jest.Mock;
  relayout: jest.Mock;
  downloadImage: jest.Mock;
  /** In manual mode, the react calls not yet resolved, oldest first. */
  pending: Deferred<void>[];
}

export function fakePlotly(manual = false): Fake {
  const pending: Deferred<void>[] = [];
  const react = jest.fn((_root: HTMLElement, _data: readonly object[], _layout?: object, _config?: object): Promise<unknown> => {
    if (!manual) return Promise.resolve();
    const d = deferred<void>();
    pending.push(d);
    return d.promise;
  });
  const purge = jest.fn((_root: HTMLElement): void => undefined);
  const resize = jest.fn((_root: HTMLElement): unknown => undefined);
  const relayout = jest.fn(async (_root: HTMLElement, _update: object): Promise<unknown> => undefined);
  const downloadImage = jest.fn(async (_root: HTMLElement, _options: object): Promise<unknown> => "");
  return { api: { react, purge, relayout, downloadImage, Plots: { resize } }, react, purge, resize, relayout, downloadImage, pending };
}

export const THEME: PlotTheme = { text: "#112233", muted: "#778899", grid: "#445566", font: "Test Sans", bg: "#fdfdfd", palette: ["#aa0000", "#00aa00", "#0000aa"] };

export function spec2(traces: PlotSpec["traces"], extra: Partial<PlotSpec> = {}): PlotSpec {
  return { v: 1, dim: 2, axes: { x: {}, y: {} }, traces, ...extra };
}

export function spec3(traces: PlotSpec["traces"], extra: Partial<PlotSpec> = {}): PlotSpec {
  return { v: 1, dim: 3, axes: { x: {}, y: {}, z: {} }, traces, ...extra };
}

export function titled(title: string): PlotSpec {
  return spec2([{ type: "line", x: [0, 1], y: [0, 1] }], { title });
}

export function layoutTitle(call: unknown[]): string | undefined {
  return (call[2] as LayoutView).title?.text;
}

export function newDoc(): Document {
  return document.implementation.createHTMLDocument("t");
}

export function styleById(doc: Document, id: string): HTMLStyleElement[] {
  return Array.from(doc.querySelectorAll("style")).filter((s) => s.id === id);
}

export function pend(f: Fake, n: number): Deferred<void> {
  const d = f.pending[n];
  if (!d) throw new Error(`react call ${n} was never made`);
  return d;
}

export function nonceOf(el: Element): string {
  return el.getAttribute("nonce") ?? "";
}
