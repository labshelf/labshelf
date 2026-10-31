/** @jest-environment jsdom */
/**
 * Tests the plot view: the Plotly style pre-creation, the spec-to-figure mapping, the theme reader and the plot handle,
 * driven through a fake PlotlyApi handed in by the injectable loader (plotly.js itself is never imported).
 */
import type { PlotSpec } from "../../../src/qmd/plot/index";
import * as plotView from "../../../src/qmd/dom/plotView";
import {
  preparePlotlyStyles,
  readPlotTheme,
  renderPlot,
  toPlotlyFigure,
} from "../../../src/qmd/dom/plotView";
import type { PlotHandle, PlotTheme } from "../../../src/qmd/dom/plotView";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** The part of the plotly.js API the plot view calls (declared here: the module's own type export is a seam of another file). */
interface PlotlyApi {
  react(root: HTMLElement, data: readonly object[], layout?: object, config?: object): Promise<unknown>;
  purge(root: HTMLElement): void;
  Plots: { resize(root: HTMLElement): unknown };
}

// Plain consts are read through the namespace inside test bodies, after a function of the module has been called.
const ids = (): readonly string[] => (plotView as any).PLOTLY_STYLE_IDS;
const defaultPalette = (): readonly string[] => (plotView as any).DEFAULT_PLOT_PALETTE;

interface Deferred<T> { promise: Promise<T>; resolve(v: T): void; reject(e: unknown): void }

function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}

/** Lets pending promise callbacks and mutation observer callbacks run. */
async function flush(): Promise<void> {
  for (let n = 0; n < 3; n++) await new Promise<void>((r) => setTimeout(r, 0));
}

interface Fake {
  api: PlotlyApi;
  react: jest.Mock;
  purge: jest.Mock;
  resize: jest.Mock;
  /** In manual mode, the react calls not yet resolved, oldest first. */
  pending: Deferred<void>[];
}

function fakePlotly(manual = false): Fake {
  const pending: Deferred<void>[] = [];
  const react = jest.fn((_root: HTMLElement, _data: readonly object[], _layout?: object, _config?: object): Promise<unknown> => {
    if (!manual) return Promise.resolve();
    const d = deferred<void>();
    pending.push(d);
    return d.promise;
  });
  const purge = jest.fn((_root: HTMLElement): void => undefined);
  const resize = jest.fn((_root: HTMLElement): unknown => undefined);
  return { api: { react, purge, Plots: { resize } }, react, purge, resize, pending };
}

const THEME: PlotTheme = { text: "#112233", grid: "#445566", font: "Test Sans", palette: ["#aa0000", "#00aa00", "#0000aa"] };

function spec2(traces: PlotSpec["traces"], extra: Partial<PlotSpec> = {}): PlotSpec {
  return { v: 1, dim: 2, axes: { x: {}, y: {} }, traces, ...extra };
}

function spec3(traces: PlotSpec["traces"], extra: Partial<PlotSpec> = {}): PlotSpec {
  return { v: 1, dim: 3, axes: { x: {}, y: {}, z: {} }, traces, ...extra };
}

function titled(title: string): PlotSpec {
  return spec2([{ type: "line", x: [0, 1], y: [0, 1] }], { title });
}

function layoutTitle(call: unknown[]): string | undefined {
  return (call[2] as any).title?.text;
}

function newDoc(): Document {
  return document.implementation.createHTMLDocument("t");
}

function styleById(doc: Document, id: string): HTMLStyleElement[] {
  return Array.from(doc.querySelectorAll("style")).filter((s) => s.id === id);
}

function pend(f: Fake, n: number): Deferred<void> {
  const d = f.pending[n];
  if (!d) throw new Error(`react call ${n} was never made`);
  return d;
}

function nonceOf(el: Element): string {
  return el.getAttribute("nonce") ?? "";
}

describe("preparePlotlyStyles", () => {
  it("2.1a lists the two style ids Plotly looks up", () => {
    preparePlotlyStyles(newDoc());
    expect(ids()).toEqual(["plotly.js-style-global", "9f215cf04c5486422605d13261cb87401f4e7763b6296af81e98efbc0130da53"]);
  });

  it("2.1a appends one empty style per id to head carrying the page script's nonce", () => {
    const doc = newDoc();
    const script = doc.createElement("script");
    script.setAttribute("nonce", "n0nce");
    doc.head.appendChild(script);
    preparePlotlyStyles(doc);
    for (const id of ids()) {
      const found = styleById(doc, id);
      expect(found).toHaveLength(1);
      expect(found[0]!.parentElement).toBe(doc.head);
      expect(found[0]!.textContent).toBe("");
      expect(nonceOf(found[0]!)).toBe("n0nce");
    }
  });

  it("2.1a takes the nonce from the first script that carries one", () => {
    const doc = newDoc();
    const plain = doc.createElement("script");
    const first = doc.createElement("script");
    first.setAttribute("nonce", "first");
    const second = doc.createElement("script");
    second.setAttribute("nonce", "second");
    doc.head.append(plain, first, second);
    preparePlotlyStyles(doc);
    expect(nonceOf(styleById(doc, ids()[0]!)[0]!)).toBe("first");
  });

  it("2.1a adds nothing on a second call", () => {
    const doc = newDoc();
    preparePlotlyStyles(doc);
    const before = doc.querySelectorAll("style").length;
    preparePlotlyStyles(doc);
    expect(doc.querySelectorAll("style")).toHaveLength(before);
    expect(before).toBe(ids().length);
  });

  it("2.1a leaves an existing element of that id untouched and still adds the missing one", () => {
    const doc = newDoc();
    const script = doc.createElement("script");
    script.setAttribute("nonce", "abc");
    doc.head.appendChild(script);
    const existing = doc.createElement("style");
    existing.id = "plotly.js-style-global";
    existing.textContent = ".keep{color:red}";
    doc.body.appendChild(existing);
    preparePlotlyStyles(doc);
    const found = styleById(doc, ids()[0]!);
    expect(found).toEqual([existing]);
    expect(existing.textContent).toBe(".keep{color:red}");
    expect(existing.hasAttribute("nonce")).toBe(false);
    expect(existing.parentElement).toBe(doc.body);
    expect(styleById(doc, ids()[1]!)).toHaveLength(1);
  });

  it("2.1a uses an empty nonce when the page has no nonce'd script", () => {
    const doc = newDoc();
    doc.head.appendChild(doc.createElement("script"));
    preparePlotlyStyles(doc);
    for (const id of ids()) {
      const found = styleById(doc, id);
      expect(found).toHaveLength(1);
      expect(nonceOf(found[0]!)).toBe("");
    }
  });
});

describe("toPlotlyFigure traces", () => {
  it("2.1b maps a 2D line trace to a scatter with mode lines", () => {
    const fig = toPlotlyFigure(spec2([{ type: "line", x: [0, 1, 2], y: [3, 4, 5] }]), THEME);
    expect(fig.data).toHaveLength(1);
    expect(fig.data[0]).toMatchObject({ type: "scatter", mode: "lines", x: [0, 1, 2], y: [3, 4, 5] });
  });

  it("2.1b maps a 2D points trace to a scatter with mode markers", () => {
    const fig = toPlotlyFigure(spec2([{ type: "points", x: [0, 1], y: [2, 3] }]), THEME);
    expect(fig.data[0]).toMatchObject({ type: "scatter", mode: "markers", x: [0, 1], y: [2, 3] });
  });

  it("2.1b maps a 3D line trace to scatter3d with z", () => {
    const fig = toPlotlyFigure(spec3([{ type: "line", x: [0, 1], y: [2, 3], z: [4, 5] }]), THEME);
    expect(fig.data[0]).toMatchObject({ type: "scatter3d", mode: "lines", x: [0, 1], y: [2, 3], z: [4, 5] });
  });

  it("2.1b maps a 3D points trace to scatter3d with markers", () => {
    const fig = toPlotlyFigure(spec3([{ type: "points", x: [0, 1], y: [2, 3], z: [4, 5] }]), THEME);
    expect(fig.data[0]).toMatchObject({ type: "scatter3d", mode: "markers", z: [4, 5] });
  });

  it("2.1b passes null values through as gaps", () => {
    const fig = toPlotlyFigure(spec2([{ type: "line", x: [0, 1, 2], y: [1, null, 3] }]), THEME);
    expect((fig.data[0] as any).y).toEqual([1, null, 3]);
  });

  it("2.1b maps a surface to a surface with showscale false", () => {
    const z = [[1, 2], [3, null]];
    const fig = toPlotlyFigure(spec3([{ type: "surface", x: [0, 1], y: [0, 1], z }]), THEME);
    expect(fig.data[0]).toMatchObject({ type: "surface", x: [0, 1], y: [0, 1], z, showscale: false });
  });

  it("2.1b maps mesh vertices to x/y/z and faces to i/j/k of a mesh3d", () => {
    const fig = toPlotlyFigure(
      spec3([{ type: "mesh", vertices: [[0, 0, 0], [1, 0, 0], [0, 2, 0], [0, 0, 3]], faces: [[0, 1, 2], [0, 1, 3]] }]),
      THEME,
    );
    expect(fig.data[0]).toMatchObject({
      type: "mesh3d",
      x: [0, 1, 0, 0],
      y: [0, 0, 2, 0],
      z: [0, 0, 0, 3],
      i: [0, 0],
      j: [1, 1],
      k: [2, 3],
    });
  });
});

describe("toPlotlyFigure colours, layout and config", () => {
  it("2.1c takes a trace colour from trace.color on lines, points, surfaces and meshes", () => {
    const fig = toPlotlyFigure(
      spec3([
        { type: "line", color: "#111111", x: [0], y: [0], z: [0] },
        { type: "points", color: "#222222", x: [0], y: [0], z: [0] },
        { type: "surface", color: "#333333", x: [0, 1], y: [0, 1], z: [[0, 0], [0, 0]] },
        { type: "mesh", color: "#444444", vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], faces: [[0, 1, 2]] },
      ]),
      THEME,
    );
    const d = fig.data as any[];
    expect(d[0].line.color).toBe("#111111");
    expect(d[1].marker.color).toBe("#222222");
    expect(d[2].colorscale).toEqual([[0, "#333333"], [1, "#333333"]]);
    expect(d[3].color).toBe("#444444");
  });

  it("2.1c takes colours from the palette in order and wraps around", () => {
    const traces: PlotSpec["traces"] = [0, 1, 2, 3].map(() => ({ type: "line" as const, x: [0, 1], y: [0, 1] }));
    const d = toPlotlyFigure(spec2(traces), THEME).data as any[];
    expect(d.map((t) => t.line.color)).toEqual(["#aa0000", "#00aa00", "#0000aa", "#aa0000"]);
  });

  it("2.1c counts a trace with an explicit colour in the palette position of later traces", () => {
    const d = toPlotlyFigure(
      spec2([
        { type: "line", color: "#abcdef", x: [0], y: [0] },
        { type: "points", x: [0], y: [0] },
      ]),
      THEME,
    ).data as any[];
    expect(d[1].marker.color).toBe("#00aa00");
  });

  it("2.1c copies trace names and shows the legend only when a trace has a name", () => {
    const named = toPlotlyFigure(spec2([{ type: "line", name: "alpha", x: [0], y: [0] }, { type: "line", x: [0], y: [0] }]), THEME);
    expect((named.data[0] as any).name).toBe("alpha");
    expect((named.layout as any).showlegend).toBe(true);
    const unnamed = toPlotlyFigure(spec2([{ type: "line", x: [0], y: [0] }]), THEME);
    expect((unnamed.layout as any).showlegend).toBe(false);
  });

  it("2.1c puts axis labels, log type and log10 ranges on xaxis and yaxis in 2D", () => {
    const fig = toPlotlyFigure(
      spec2([{ type: "line", x: [1, 2], y: [1, 2] }], {
        axes: { x: { label: "time", log: true, range: [10, 1000] }, y: { range: [-2, 5] } },
      }),
      THEME,
    );
    const layout = fig.layout as any;
    expect(layout.xaxis.title).toEqual({ text: "time" });
    expect(layout.xaxis.type).toBe("log");
    expect(layout.xaxis.range[0]).toBeCloseTo(1, 10);
    expect(layout.xaxis.range[1]).toBeCloseTo(3, 10);
    expect(layout.yaxis.type).toBe("linear");
    expect(layout.yaxis.range).toEqual([-2, 5]);
    expect(layout.yaxis.title).toBeUndefined();
  });

  it("2.1c sets no range on an axis without one", () => {
    const layout = toPlotlyFigure(spec2([{ type: "line", x: [0], y: [0] }]), THEME).layout as any;
    expect(layout.xaxis.range).toBeUndefined();
    expect(layout.xaxis.type).toBe("linear");
  });

  it("2.1c colours the grid, zero line and text of 2D axes from the theme", () => {
    const layout = toPlotlyFigure(spec2([{ type: "line", x: [0], y: [0] }]), THEME).layout as any;
    for (const axis of [layout.xaxis, layout.yaxis]) {
      expect(axis.gridcolor).toBe("#445566");
      expect(axis.zerolinecolor).toBe("#445566");
      expect(axis.color).toBe("#112233");
    }
  });

  it("2.1c puts the axes of a 3D plot on the scene and never on layout.xaxis", () => {
    const fig = toPlotlyFigure(
      spec3([{ type: "line", x: [1], y: [1], z: [1] }], {
        axes: { x: { label: "a" }, y: { label: "b", log: true, range: [1, 100] }, z: { label: "c", range: [0, 9] } },
      }),
      THEME,
    );
    const layout = fig.layout as any;
    expect(layout.xaxis).toBeUndefined();
    expect(layout.yaxis).toBeUndefined();
    expect(layout.scene.xaxis.title).toEqual({ text: "a" });
    expect(layout.scene.yaxis.title).toEqual({ text: "b" });
    expect(layout.scene.yaxis.type).toBe("log");
    expect(layout.scene.yaxis.range[0]).toBeCloseTo(0, 10);
    expect(layout.scene.yaxis.range[1]).toBeCloseTo(2, 10);
    expect(layout.scene.zaxis.title).toEqual({ text: "c" });
    expect(layout.scene.zaxis.type).toBe("linear");
    expect(layout.scene.zaxis.range).toEqual([0, 9]);
    expect(layout.scene.zaxis.gridcolor).toBe("#445566");
    expect(layout.scene.zaxis.color).toBe("#112233");
  });

  it("2.1c makes the backgrounds transparent and takes the font from the theme", () => {
    const layout = toPlotlyFigure(spec2([{ type: "line", x: [0], y: [0] }]), THEME).layout as any;
    expect(layout.paper_bgcolor).toBe("rgba(0,0,0,0)");
    expect(layout.plot_bgcolor).toBe("rgba(0,0,0,0)");
    expect(layout.font).toEqual({ color: "#112233", family: "Test Sans" });
  });

  it("2.1c sets the title only when the spec has one", () => {
    const withTitle = toPlotlyFigure(spec2([{ type: "line", x: [0], y: [0] }], { title: "Decay" }), THEME).layout as any;
    expect(withTitle.title).toEqual({ text: "Decay" });
    const without = toPlotlyFigure(spec2([{ type: "line", x: [0], y: [0] }]), THEME).layout as any;
    expect(without.title).toBeUndefined();
  });

  it("2.1c keeps the zoom across redraws with a fixed uirevision and closest hover", () => {
    const layout = toPlotlyFigure(spec2([{ type: "line", x: [0], y: [0] }]), THEME).layout as any;
    expect(layout.uirevision).toBe("labshelf");
    expect(layout.hovermode).toBe("closest");
  });

  it("2.1c sets the config to displaylogo false and responsive true", () => {
    const fig = toPlotlyFigure(spec2([{ type: "line", x: [0], y: [0] }]), THEME);
    expect(fig.config).toEqual({ displaylogo: false, responsive: true });
  });
});

describe("readPlotTheme", () => {
  let el: HTMLElement;

  beforeEach(() => {
    el = document.createElement("div");
    document.body.appendChild(el);
  });

  afterEach(() => {
    el.remove();
  });

  it("2.1d reads the text, grid and font tokens and the palette", () => {
    el.style.setProperty("--ls-fg", "#102030");
    el.style.setProperty("--ls-border-soft", "#405060");
    el.style.setProperty("--ls-font", "Fira Sans");
    el.style.setProperty("--qmd-plot-palette", "#111111,#222222,#333333");
    expect(readPlotTheme(el)).toEqual({
      text: "#102030",
      grid: "#405060",
      font: "Fira Sans",
      palette: ["#111111", "#222222", "#333333"],
    });
  });

  it("2.1d trims the values and drops empty palette parts", () => {
    el.style.setProperty("--ls-fg", "  #102030  ");
    el.style.setProperty("--qmd-plot-palette", " #111111 , ,#222222,, ");
    const theme = readPlotTheme(el);
    expect(theme.text).toBe("#102030");
    expect(theme.palette).toEqual(["#111111", "#222222"]);
  });

  it("2.1d falls back to the defaults when the tokens are unset", () => {
    expect(readPlotTheme(el)).toEqual({
      text: "#808080",
      grid: "rgba(128, 128, 128, .2)",
      font: "sans-serif",
      palette: [...defaultPalette()],
    });
  });

  it("2.1d falls back for a token that is set to blanks only", () => {
    el.style.setProperty("--ls-fg", "   ");
    el.style.setProperty("--qmd-plot-palette", " , ");
    const theme = readPlotTheme(el);
    expect(theme.text).toBe("#808080");
    expect(theme.palette).toEqual([...defaultPalette()]);
  });

  it("2.1d defines the default palette as ten colours", () => {
    readPlotTheme(el);
    expect(defaultPalette()).toEqual([
      "#4e79a7", "#f28e2b", "#e15759", "#76b7b2", "#59a14f", "#edc948", "#b07aa1", "#ff9da7", "#9c755f", "#bab0ac",
    ]);
  });
});

describe("renderPlot", () => {
  let root: HTMLElement;
  let handles: PlotHandle[];

  function draw(s: PlotSpec, f: Fake): PlotHandle {
    const h = renderPlot(root, s, async () => f.api);
    handles.push(h);
    return h;
  }

  beforeEach(() => {
    root = document.createElement("div");
    root.className = "plot";
    document.body.appendChild(root);
    handles = [];
  });

  afterEach(() => {
    for (const h of handles) h.destroy();
    root.remove();
    document.documentElement.removeAttribute("data-theme");
    document.head.querySelectorAll("style[data-test]").forEach((s) => s.remove());
    delete (window as any).matchMedia;
  });

  it("2.1e calls the loader once and Plotly.react on the root with the figure of the spec", async () => {
    const f = fakePlotly();
    const loader = jest.fn(async () => f.api);
    const s = titled("first");
    const h = renderPlot(root, s, loader);
    handles.push(h);
    await h.drawn;
    expect(loader).toHaveBeenCalledTimes(1);
    expect(f.react).toHaveBeenCalledTimes(1);
    const [r, data, layout, config] = f.react.mock.calls[0];
    const fig = toPlotlyFigure(s, readPlotTheme(root));
    expect(r).toBe(root);
    expect(data).toEqual(fig.data);
    expect(layout).toEqual(fig.layout);
    expect(config).toEqual(fig.config);
  });

  it("2.1e resolves drawn only after the first react resolves", async () => {
    const f = fakePlotly(true);
    const h = draw(titled("first"), f);
    let settled = false;
    void h.drawn.then(() => { settled = true; });
    await flush();
    expect(f.react).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
    pend(f, 0).resolve();
    await h.drawn;
    expect(settled).toBe(true);
  });

  it("2.1e rejects drawn with the loader's error when the loader fails", async () => {
    const h = renderPlot(root, titled("x"), async () => { throw new Error("no bundle"); });
    handles.push(h);
    await expect(h.drawn).rejects.toThrow("no bundle");
  });

  it("2.1e rejects drawn with react's error when react fails", async () => {
    const f = fakePlotly();
    f.react.mockImplementation(() => Promise.reject(new Error("bad figure")));
    const h = draw(titled("x"), f);
    await expect(h.drawn).rejects.toThrow("bad figure");
  });

  it("2.1e never adds, removes or restyles the root's children or attributes itself", async () => {
    const f = fakePlotly();
    const child = document.createElement("span");
    root.appendChild(child);
    const h = draw(titled("x"), f);
    await h.drawn;
    expect(Array.from(root.childNodes)).toEqual([child]);
    expect(root.hasAttribute("style")).toBe(false);
  });

  it("2.1f update redraws on the same root with react and never purges", async () => {
    const f = fakePlotly();
    const h = draw(titled("one"), f);
    await h.drawn;
    await h.update(titled("two"));
    expect(f.react).toHaveBeenCalledTimes(2);
    expect(f.react.mock.calls[1][0]).toBe(root);
    expect(layoutTitle(f.react.mock.calls[1])).toBe("two");
    expect(f.purge).not.toHaveBeenCalled();
  });

  it("2.1f with a react in flight, of three quick updates only the last is drawn after it", async () => {
    const f = fakePlotly(true);
    const h = draw(titled("first"), f);
    await flush();
    expect(f.react).toHaveBeenCalledTimes(1);
    const p1 = h.update(titled("B"));
    const p2 = h.update(titled("C"));
    const p3 = h.update(titled("D"));
    await flush();
    expect(f.react).toHaveBeenCalledTimes(1);
    pend(f, 0).resolve();
    await flush();
    expect(f.react).toHaveBeenCalledTimes(2);
    expect(layoutTitle(f.react.mock.calls[1])).toBe("D");
    pend(f, 1).resolve();
    await Promise.all([p1, p2, p3, h.drawn]);
    await flush();
    expect(f.react).toHaveBeenCalledTimes(2);
    expect(f.purge).not.toHaveBeenCalled();
  });

  it("2.1f before the loader resolved, the first draw uses the latest spec", async () => {
    const f = fakePlotly();
    const gate = deferred<PlotlyApi>();
    const h = renderPlot(root, titled("A"), () => gate.promise);
    handles.push(h);
    const p1 = h.update(titled("B"));
    const p2 = h.update(titled("C"));
    await flush();
    expect(f.react).not.toHaveBeenCalled();
    gate.resolve(f.api);
    await Promise.all([h.drawn, p1, p2]);
    await flush();
    expect(f.react).toHaveBeenCalledTimes(1);
    expect(layoutTitle(f.react.mock.calls[0])).toBe("C");
  });

  it("2.1f the promise of an update resolves once a later spec has been drawn", async () => {
    const f = fakePlotly(true);
    const h = draw(titled("first"), f);
    await flush();
    const early = h.update(titled("B"));
    let earlyDone = false;
    void early.then(() => { earlyDone = true; });
    const late = h.update(titled("C"));
    pend(f, 0).resolve();
    await flush();
    expect(earlyDone).toBe(false);
    pend(f, 1).resolve();
    await Promise.all([early, late]);
    expect(earlyDone).toBe(true);
  });
});

describe("renderPlot theme", () => {
  let root: HTMLElement;
  let sheet: HTMLStyleElement;
  let handles: PlotHandle[];

  function draw(s: PlotSpec, f: Fake): PlotHandle {
    const h = renderPlot(root, s, async () => f.api);
    handles.push(h);
    return h;
  }

  function fontColor(call: unknown[]): string {
    return (call[2] as any).font.color;
  }

  beforeEach(() => {
    sheet = document.createElement("style");
    sheet.setAttribute("data-test", "");
    sheet.textContent = '.plot { --ls-fg: #111111 } :root[data-theme="dark"] .plot { --ls-fg: #eeeeee }';
    document.head.appendChild(sheet);
    root = document.createElement("div");
    root.className = "plot";
    document.body.appendChild(root);
    handles = [];
  });

  afterEach(() => {
    for (const h of handles) h.destroy();
    root.remove();
    sheet.remove();
    document.documentElement.removeAttribute("data-theme");
    document.body.removeAttribute("class");
    delete (window as any).matchMedia;
  });

  it("2.1g redraws a live plot with the new font colour when data-theme changes", async () => {
    const f = fakePlotly();
    const s = titled("themed");
    const h = draw(s, f);
    await h.drawn;
    expect(fontColor(f.react.mock.calls[0])).toBe("#111111");
    document.documentElement.setAttribute("data-theme", "dark");
    await flush();
    expect(f.react).toHaveBeenCalledTimes(2);
    expect(f.react.mock.calls[1][0]).toBe(root);
    expect(fontColor(f.react.mock.calls[1])).toBe("#eeeeee");
    expect(layoutTitle(f.react.mock.calls[1])).toBe("themed");
  });

  it("2.1g redraws the current spec, not the first one, after an update", async () => {
    const f = fakePlotly();
    const h = draw(titled("old"), f);
    await h.drawn;
    await h.update(titled("new"));
    document.documentElement.setAttribute("data-theme", "dark");
    await flush();
    const last = f.react.mock.calls[f.react.mock.calls.length - 1];
    expect(layoutTitle(last)).toBe("new");
    expect(fontColor(last)).toBe("#eeeeee");
  });

  it("2.1g does not redraw when the theme attribute changes but the resolved theme does not", async () => {
    const f = fakePlotly();
    const h = draw(titled("same"), f);
    await h.drawn;
    document.documentElement.setAttribute("data-theme", "sepia");
    await flush();
    document.documentElement.setAttribute("class", "other");
    document.body.setAttribute("class", "x");
    await flush();
    expect(f.react).toHaveBeenCalledTimes(1);
  });

  it("2.1g redraws when the body's attributes change the theme", async () => {
    const f = fakePlotly();
    sheet.textContent = '.plot { --ls-fg: #111111 } body.night .plot { --ls-fg: #cccccc }';
    const h = draw(titled("body"), f);
    await h.drawn;
    document.body.setAttribute("class", "night");
    await flush();
    expect(f.react).toHaveBeenCalledTimes(2);
    expect(fontColor(f.react.mock.calls[1])).toBe("#cccccc");
  });

  it("2.1g redraws when the prefers-color-scheme media query changes", async () => {
    const listeners: Array<() => void> = [];
    const add = jest.fn((_type: string, l: () => void) => { listeners.push(l); });
    const remove = jest.fn();
    (window as any).matchMedia = jest.fn(() => ({ matches: false, addEventListener: add, removeEventListener: remove }));
    const f = fakePlotly();
    const h = draw(titled("media"), f);
    await h.drawn;
    expect((window as any).matchMedia).toHaveBeenCalledWith("(prefers-color-scheme: dark)");
    expect(add).toHaveBeenCalledWith("change", expect.any(Function));
    sheet.textContent = '.plot { --ls-fg: #222222 }';
    for (const l of listeners) l();
    await flush();
    expect(f.react).toHaveBeenCalledTimes(2);
    expect(fontColor(f.react.mock.calls[1])).toBe("#222222");
  });

  it("2.1g keeps one watcher for all live handles: both redraw and the media listener is added once", async () => {
    const add = jest.fn();
    const remove = jest.fn();
    (window as any).matchMedia = jest.fn(() => ({ matches: false, addEventListener: add, removeEventListener: remove }));
    const f = fakePlotly();
    const root2 = document.createElement("div");
    root2.className = "plot";
    document.body.appendChild(root2);
    const h1 = draw(titled("one"), f);
    const h2 = renderPlot(root2, titled("two"), async () => f.api);
    handles.push(h2);
    await Promise.all([h1.drawn, h2.drawn]);
    expect(add).toHaveBeenCalledTimes(1);
    document.documentElement.setAttribute("data-theme", "dark");
    await flush();
    expect(f.react).toHaveBeenCalledTimes(4);
    h1.destroy();
    expect(remove).not.toHaveBeenCalled();
    h2.destroy();
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith("change", add.mock.calls[0][1]);
    root2.remove();
  });

  it("2.1h destroy purges the root once Plotly has loaded", async () => {
    const f = fakePlotly();
    const h = draw(titled("gone"), f);
    await h.drawn;
    h.destroy();
    expect(f.purge).toHaveBeenCalledTimes(1);
    expect(f.purge).toHaveBeenCalledWith(root);
  });

  it("2.1h destroy stops theme redraws", async () => {
    const f = fakePlotly();
    const h = draw(titled("stopped"), f);
    await h.drawn;
    h.destroy();
    document.documentElement.setAttribute("data-theme", "dark");
    await flush();
    expect(f.react).toHaveBeenCalledTimes(1);
  });

  it("2.1h destroying one handle leaves the theme redraw of another alive", async () => {
    const f = fakePlotly();
    const root2 = document.createElement("div");
    root2.className = "plot";
    document.body.appendChild(root2);
    const h1 = draw(titled("dead"), f);
    const h2 = renderPlot(root2, titled("alive"), async () => f.api);
    handles.push(h2);
    await Promise.all([h1.drawn, h2.drawn]);
    h1.destroy();
    f.react.mockClear();
    document.documentElement.setAttribute("data-theme", "dark");
    await flush();
    expect(f.react).toHaveBeenCalledTimes(1);
    expect(f.react.mock.calls[0][0]).toBe(root2);
    root2.remove();
  });

  it("2.1h a loader resolving after destroy draws nothing", async () => {
    const f = fakePlotly();
    const gate = deferred<PlotlyApi>();
    const h = renderPlot(root, titled("late"), () => gate.promise);
    handles.push(h);
    h.destroy();
    gate.resolve(f.api);
    await flush();
    expect(f.react).not.toHaveBeenCalled();
  });

  it("2.1h update after destroy resolves without drawing", async () => {
    const f = fakePlotly();
    const h = draw(titled("one"), f);
    await h.drawn;
    h.destroy();
    await h.update(titled("two"));
    expect(f.react).toHaveBeenCalledTimes(1);
  });

  it("2.1h an update waiting behind an in-flight react is not drawn after destroy", async () => {
    const f = fakePlotly(true);
    const h = draw(titled("one"), f);
    await flush();
    void h.update(titled("two"));
    h.destroy();
    pend(f, 0).resolve();
    await flush();
    expect(f.react).toHaveBeenCalledTimes(1);
  });
});
