/** @jest-environment jsdom */
/**
 * Tests the plot handle renderPlot returns: latest-wins updates, load failures, destroy and theme redraws,
 * driven through a fake PlotlyApi handed in by the injectable loader (plotly.js itself is never imported).
 */
import type { PlotSpec } from "../../../src/qmd/item/plotSpec";
import { readPlotTheme, toPlotlyFigure } from "../../../src/qmd/dom/plotView";
import { renderPlot, type PlotHandle } from "../../../src/qmd/dom/plotRender";
import { type PlotlyApi, type LayoutView, installMatchMedia, restoreMatchMedia, deferred, flush, type Fake, fakePlotly, titled, layoutTitle, pend } from "./plotViewHarness";

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
    restoreMatchMedia();
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
    return (call[2] as LayoutView).font?.color ?? "";
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
    restoreMatchMedia();
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
    const matchMedia = installMatchMedia(add, remove);
    const f = fakePlotly();
    const h = draw(titled("media"), f);
    await h.drawn;
    expect(matchMedia).toHaveBeenCalledWith("(prefers-color-scheme: dark)");
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
    installMatchMedia(add, remove);
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

describe("renderPlot view actions", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
  });

  afterEach(() => root.remove());

  const line = (dim: 2 | 3): PlotSpec => dim === 2
    ? { v: 1, dim: 2, axes: { x: {}, y: {} }, traces: [{ type: "line", x: [0, 1], y: [0, 1] }] }
    : { v: 1, dim: 3, axes: { x: {}, y: {}, z: {} }, traces: [{ type: "line", x: [0, 1], y: [0, 1], z: [0, 1] }] };

  it("S3 resetView relayouts a drawn 2D plot to autorange", async () => {
    const f = fakePlotly();
    const h = renderPlot(root, line(2), async () => f.api);
    await h.drawn;
    await h.resetView();
    expect(f.relayout).toHaveBeenCalledWith(root, { "xaxis.autorange": true, "yaxis.autorange": true });
    h.destroy();
  });

  it("S3 resetView resets the camera of the spec last drawn, a 3D plot after an update", async () => {
    const f = fakePlotly();
    const h = renderPlot(root, line(2), async () => f.api);
    await h.drawn;
    await h.update(line(3));
    await h.resetView();
    expect(Object.keys(f.relayout.mock.calls[0]![1] as object)).toEqual(["scene.camera"]);
    h.destroy();
  });

  it("S3 downloadPng hands the root to Plotly's image download as a PNG with the file name", async () => {
    const f = fakePlotly();
    const h = renderPlot(root, line(2), async () => f.api);
    await h.drawn;
    await h.downloadPng("Sine wave");
    expect(f.downloadImage).toHaveBeenCalledWith(root, expect.objectContaining({ format: "png", filename: "Sine wave" }));
    h.destroy();
  });

  it("S3 does nothing before Plotly is loaded or after destroy", async () => {
    const f = fakePlotly();
    const gate = deferred<PlotlyApi>();
    const h = renderPlot(root, line(2), () => gate.promise);
    await h.resetView();
    await h.downloadPng("x");
    gate.resolve(f.api);
    await h.drawn;
    h.destroy();
    await h.resetView();
    await h.downloadPng("x");
    expect(f.relayout).not.toHaveBeenCalled();
    expect(f.downloadImage).not.toHaveBeenCalled();
  });
});
