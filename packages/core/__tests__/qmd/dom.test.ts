/** @jest-environment jsdom */
/**
 * Spec 5.2 (interactive-plots): slider previews start at once (one in flight per cell, the latest value queued, no timer),
 * and a preview result that carries a plot spec updates the shown figure in place, also for a cell without a stored output.
 * Driven through the code cell view and the output view mounted by the param strip harness; Plotly is a fake behind loadCorePlotly.
 */
import { qmdSchema as s } from "../../src/qmd/editor/qmdSchema";
import { formatOutput, formatPlotContent } from "../../src/qmd/item/cellOutput";
import { formatPlotSpec, type PlotSpec } from "../../src/qmd/item/plotSpec";
import { OK, OPTIONS, cell, drag, finishNormalRun, mountCell, rangeOf, release, resultOutput, useStripLifecycle } from "./dom/cellParamStripHarness";

const mockApi = { react: jest.fn(async (..._args: unknown[]) => ({})), purge: jest.fn(), Plots: { resize: jest.fn() } };
jest.mock("../../src/qmd/dom/plotView", () => ({
  ...jest.requireActual("../../src/qmd/dom/plotView"),
  loadCorePlotly: () => Promise.resolve(mockApi),
}));

useStripLifecycle();
beforeEach(() => { mockApi.react.mockClear(); mockApi.purge.mockClear(); });

const SPEC_A: PlotSpec = { v: 1, dim: 2, title: "Sine wave", axes: { x: { label: "x" }, y: { label: "y" } }, traces: [{ type: "line", name: "a", x: [0, 1, 2], y: [0, 1, 0] }] };
const SPEC_B: PlotSpec = { v: 1, dim: 2, title: "Cosine wave", axes: { x: { label: "x" }, y: { label: "y" } }, traces: [{ type: "line", name: "b", x: [0, 1, 2], y: [1, 0, 1] }] };
const SPEC_C: PlotSpec = { v: 1, dim: 2, title: "Flat wave", axes: { x: { label: "x" }, y: { label: "y" } }, traces: [{ type: "line", name: "c", x: [0, 1, 2], y: [2, 2, 2] }] };
const IMAGE = { alt: "Python plot", src: "data:image/png;base64,iVBORw0KGgo=" };

/** A preview result that carries `spec`, with no PNG. */
const withSpec = (spec: PlotSpec) => ({ ...OK, plot: formatPlotSpec(spec)! });

/** Turns any failure into "not implemented: ..." so a red run shows the behaviour is absent; the original message is kept. */
const behaviour = <A extends unknown[]>(body: (...args: A) => Promise<void> | void) => async (...args: A): Promise<void> => {
  try {
    await body(...args);
  } catch (error) {
    throw new Error(`not implemented: undebounced previews and live plot previews (${error instanceof Error ? error.message : String(error)})`);
  }
};

/** Lets promises and zero or short timers run; the strip tests use fake timers. */
async function settle(): Promise<void> {
  for (let round = 0; round < 4; round++) {
    for (let i = 0; i < 40; i++) await Promise.resolve();
    jest.advanceTimersByTime(20);
  }
}

async function plotOutput(spec: PlotSpec) {
  const content = formatPlotContent(IMAGE, spec);
  const raw = formatOutput({ cell: "sim", source: "000000000000", engine: "python", ran: "2026-10-30", content });
  return s.node("output", { cell: "sim", source: "000000000000", engine: "python", ran: "2026-10-30", raw });
}

const figureRoot = (dom: ParentNode) => dom.querySelector<HTMLElement>(".qmd-output-plot:not(.qmd-plot-expanded)");

describe("5.2a slider previews are not debounced", () => {
  it("5.2a an input event starts a preview at once, with no timer advance", behaviour(() => {
    const m = mountCell([cell(OPTIONS)]);
    drag(rangeOf(m.view), 6);
    expect(m.previews()).toHaveLength(1);
    expect(m.previews()[0]!.params).toEqual({ speed: 6 });
  }));

  it("5.2a inputs while a preview is in flight start no other preview", behaviour(() => {
    const m = mountCell([cell(OPTIONS)]);
    const range = rangeOf(m.view);
    drag(range, 6);
    expect(m.previews()).toHaveLength(1);
    drag(range, 7);
    drag(range, 8);
    expect(m.previews()).toHaveLength(1);
    jest.advanceTimersByTime(5000);
    expect(m.previews()).toHaveLength(1);
    expect(m.calls).toHaveLength(1);
  }));

  it("5.2a when the preview ends, one preview runs with the last value dragged", behaviour(() => {
    const m = mountCell([cell(OPTIONS)]);
    const range = rangeOf(m.view);
    drag(range, 6);
    expect(m.previews()).toHaveLength(1);
    drag(range, 7);
    drag(range, 8);
    m.previews()[0]!.preview!(undefined);
    expect(m.previews()).toHaveLength(2);
    expect(m.previews()[1]!.params).toEqual({ speed: 8 });
    m.previews()[1]!.preview!(undefined);
    jest.advanceTimersByTime(5000);
    expect(m.previews()).toHaveLength(2);
    expect(m.normals()).toHaveLength(0);
  }));

  it("5.2a an input after the previews ended starts a new preview at once", behaviour(() => {
    const m = mountCell([cell(OPTIONS)]);
    const range = rangeOf(m.view);
    drag(range, 6);
    expect(m.previews()).toHaveLength(1);
    m.previews()[0]!.preview!(undefined);
    drag(range, 2);
    expect(m.previews()).toHaveLength(2);
    expect(m.previews()[1]!.params).toEqual({ speed: 2 });
  }));

  it("5.2a a release waits for the preview in flight and then runs once, with the released value", behaviour(() => {
    const m = mountCell([cell(OPTIONS)]);
    const range = rangeOf(m.view);
    drag(range, 6);
    expect(m.previews()).toHaveLength(1);
    drag(range, 7);
    release(range);
    jest.advanceTimersByTime(5000);
    expect(m.normals()).toHaveLength(0);
    m.previews()[0]!.preview!(undefined);
    jest.advanceTimersByTime(5000);
    expect(m.previews()).toHaveLength(1);
    expect(m.normals()).toHaveLength(1);
    expect(m.normals()[0]!.params).toEqual({ speed: 7 });
  }));
});

describe("5.2b a preview with a spec on an output that shows a plot", () => {
  it("5.2b calls Plotly.react again on the same plot element without replacing the output body", behaviour(async () => {
    const m = mountCell([cell(OPTIONS), await plotOutput(SPEC_A)]);
    await settle();
    expect(mockApi.react).toHaveBeenCalledTimes(1);
    const root = figureRoot(m.view.dom)!;
    const body = m.view.dom.querySelector(".qmd-output-body")!;
    expect(root).not.toBeNull();
    drag(rangeOf(m.view), 6);
    m.previews()[0]!.preview!(withSpec(SPEC_B));
    await settle();
    expect(mockApi.react).toHaveBeenCalledTimes(2);
    expect(mockApi.react.mock.calls[1]![0]).toBe(root);
    expect(figureRoot(m.view.dom)).toBe(root);
    expect(m.view.dom.querySelector(".qmd-output-body")).toBe(body);
    expect(mockApi.react.mock.calls[1]![1]).not.toEqual(mockApi.react.mock.calls[0]![1]);
    expect(mockApi.purge).not.toHaveBeenCalled();
  }));

  it("5.2b a second preview with another spec updates the same element again", behaviour(async () => {
    const m = mountCell([cell(OPTIONS), await plotOutput(SPEC_A)]);
    await settle();
    const root = figureRoot(m.view.dom)!;
    const body = m.view.dom.querySelector(".qmd-output-body")!;
    const range = rangeOf(m.view);
    drag(range, 6);
    m.previews()[0]!.preview!(withSpec(SPEC_B));
    await settle();
    drag(range, 7);
    m.previews()[1]!.preview!(withSpec(SPEC_C));
    await settle();
    expect(mockApi.react).toHaveBeenCalledTimes(3);
    expect(mockApi.react.mock.calls[2]![0]).toBe(root);
    expect(mockApi.react.mock.calls[2]![1]).not.toEqual(mockApi.react.mock.calls[1]![1]);
    expect(figureRoot(m.view.dom)).toBe(root);
    expect(m.view.dom.querySelector(".qmd-output-body")).toBe(body);
    expect(mockApi.purge).not.toHaveBeenCalled();
  }));
});

describe("5.2c a preview on an output decides the view by its spec", () => {
  it("5.2c a preview without a spec on a plot output shows its text", behaviour(async () => {
    const m = mountCell([cell(OPTIONS), await plotOutput(SPEC_A)]);
    await settle();
    drag(rangeOf(m.view), 6);
    m.previews()[0]!.preview!({ ...OK, text: "preview-text-6" });
    await settle();
    expect(m.view.dom.querySelector(".qmd-output-text")!.textContent).toBe("preview-text-6");
    expect(figureRoot(m.view.dom)).toBeNull();
    expect(m.view.dom.textContent).toContain("preview-text-6");
  }));

  it("5.2c a preview with a spec and no PNG on a text output shows a figure", behaviour(async () => {
    const m = mountCell([cell(OPTIONS), await resultOutput()]);
    await settle();
    expect(m.view.dom.textContent).toContain("result-text-42");
    drag(rangeOf(m.view), 6);
    m.previews()[0]!.preview!(withSpec(SPEC_A));
    await settle();
    const root = figureRoot(m.view.dom)!;
    expect(root).not.toBeNull();
    expect(mockApi.react).toHaveBeenCalledTimes(1);
    expect(mockApi.react.mock.calls[0]![0]).toBe(root);
    expect(m.view.dom.textContent).not.toContain("result-text-42");
  }));

  it("5.2c a spec preview without a PNG leaves the figure as the only view of the output", behaviour(async () => {
    const m = mountCell([cell(OPTIONS), await resultOutput()]);
    await settle();
    drag(rangeOf(m.view), 6);
    m.previews()[0]!.preview!(withSpec(SPEC_A));
    await settle();
    expect(figureRoot(m.view.dom)).not.toBeNull();
    expect(m.view.dom.querySelector("img")).toBeNull();
    expect(m.view.dom.querySelector(".qmd-output-text")).toBeNull();
  }));
});

describe("5.2d a cell without a stored output", () => {
  it("5.2d shows a preview with a spec as a figure", behaviour(async () => {
    const m = mountCell([cell(OPTIONS)]);
    drag(rangeOf(m.view), 6);
    m.previews()[0]!.preview!(withSpec(SPEC_A));
    await settle();
    const root = figureRoot(m.view.dom)!;
    expect(root).not.toBeNull();
    expect(mockApi.react).toHaveBeenCalledTimes(1);
    expect(mockApi.react.mock.calls[0]![0]).toBe(root);
  }));

  it("5.2d updates the figure in place on the next preview with a spec", behaviour(async () => {
    const m = mountCell([cell(OPTIONS)]);
    const range = rangeOf(m.view);
    drag(range, 6);
    m.previews()[0]!.preview!(withSpec(SPEC_A));
    await settle();
    const root = figureRoot(m.view.dom)!;
    expect(root).not.toBeNull();
    drag(range, 7);
    m.previews()[1]!.preview!(withSpec(SPEC_B));
    await settle();
    expect(mockApi.react).toHaveBeenCalledTimes(2);
    expect(mockApi.react.mock.calls[1]![0]).toBe(root);
    expect(figureRoot(m.view.dom)).toBe(root);
    expect(mockApi.react.mock.calls[1]![1]).not.toEqual(mockApi.react.mock.calls[0]![1]);
    expect(mockApi.purge).not.toHaveBeenCalled();
  }));

  it("5.2d falls back to the text, destroying the figure, when the next preview has no spec", behaviour(async () => {
    const m = mountCell([cell(OPTIONS)]);
    const range = rangeOf(m.view);
    drag(range, 6);
    m.previews()[0]!.preview!(withSpec(SPEC_A));
    await settle();
    const root = figureRoot(m.view.dom)!;
    expect(root).not.toBeNull();
    drag(range, 7);
    m.previews()[1]!.preview!({ ...OK, text: "preview-text-7" });
    await settle();
    expect(figureRoot(m.view.dom)).toBeNull();
    expect(mockApi.purge.mock.calls.map((call) => call[0])).toContain(root);
    expect(m.view.dom.querySelector(".qmd-output-text")!.textContent).toBe("preview-text-7");
  }));

  it("5.2d destroys the figure when the preview ends with the release run", behaviour(async () => {
    const m = mountCell([cell(OPTIONS)]);
    const range = rangeOf(m.view);
    drag(range, 6);
    m.previews()[0]!.preview!(withSpec(SPEC_A));
    await settle();
    const root = figureRoot(m.view.dom)!;
    expect(root).not.toBeNull();
    release(range);
    expect(m.normals()).toHaveLength(1);
    await finishNormalRun(m.view);
    await settle();
    expect(figureRoot(m.view.dom)).toBeNull();
    expect(mockApi.purge.mock.calls.map((call) => call[0])).toContain(root);
  }));
});
