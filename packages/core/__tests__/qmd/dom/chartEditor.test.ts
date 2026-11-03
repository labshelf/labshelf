/** @jest-environment jsdom */
/**
 * Tests the chart node view opening the chart editor (plan charts, D6, D9, 2.1): click or Enter on a chart loads the editor
 * through the loader the view is given, Ok / Apply write the model and a PNG from a fake Plotly.toImage into the node's raw
 * (keeping the BOM and the note's line ending), Cancel and Esc leave the bytes unchanged, and a rejecting toImage writes the
 * block without the PNG and shows 'No image for export yet'. Plotly is a fake; nothing real is loaded.
 */
import { NodeSelection } from "prosemirror-state";
import type { Node as PmNode } from "prosemirror-model";
import type { EditorView } from "prosemirror-view";
import { docToBody } from "../../../src/qmd/editor/qmdDoc";
import { qmdSchema as s } from "../../../src/qmd/editor/qmdSchema";
import { formatChartBlock, readChartBlock } from "../../../src/qmd/chart/block";
import { formatChartPgf } from "../../../src/qmd/chart/pgf";
import type { ChartModel, ChartTable } from "../../../src/qmd/chart/model";
import { createChartView } from "../../../src/qmd/dom/figureView";
import { loadChartEditor } from "../../../src/qmd/dom/figureEditor/index";
import type { PlotlyApi, PlotlyLoader } from "../../../src/qmd/dom/plotView";
import { mount, para, text, until } from "../../support/nodeViewHarness";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAACgAAAAUCAIAAABwJOjsAAAAJElEQVR4nGNoaPg/IIhh1OJRi0ctHrV41OJRi0ctHrV45FgMAPGJPTtbDo1MAAAAAElFTkSuQmCC";
const DATA_URL = `data:image/png;base64,${PNG}`;

const TABLE: ChartTable = {
  cols: [
    { name: "t", values: [1, 2, 3] },
    { name: "v", values: [10, 20, 30] },
  ],
};

function chartModel(extra: Partial<ChartModel> = {}): ChartModel {
  return {
    v: 1,
    id: "a1b2c3d4",
    kind: "data",
    data: TABLE,
    traces: [{ type: "scatter", x: "A", y: "B", mode: "lines" }],
    fns: [],
    vars: [],
    layout: { xaxis: { type: "linear" }, yaxis: { type: "linear" }, legend: { show: true } },
    ...extra,
  };
}

const BOM = "\uFEFF";
const STORED_URL = DATA_URL;

/** A chart block as session 1.2's writer stores it, with the stored PNG, ending with a line break. */
function editorChartText(model: ChartModel, eol: "\n" | "\r\n" = "\n"): string {
  const out = formatChartBlock({ model, png: { dataUrl: STORED_URL, widthCm: 16, alt: "Stored" }, pgf: null }, eol);
  if (out === null) throw new Error("formatChartBlock returned null for a small chart");
  return out + eol;
}

interface ExportFake { api: PlotlyApi; react: jest.Mock; purge: jest.Mock; toImage: jest.Mock }

function toImagePlotly(toImage: (root: HTMLElement, options: object) => Promise<string> = async () => DATA_URL): ExportFake {
  const react = jest.fn(async (_root: HTMLElement, _data: readonly object[], _layout?: object, _config?: object): Promise<unknown> => undefined);
  const purge = jest.fn((_root: HTMLElement): void => undefined);
  const toImageMock = jest.fn(toImage);
  const api = {
    react,
    purge,
    relayout: jest.fn(async () => undefined),
    downloadImage: jest.fn(async () => undefined),
    toImage: toImageMock,
    Plots: { resize: jest.fn() },
  } as unknown as PlotlyApi;
  return { api, react, purge, toImage: toImageMock };
}

interface EditorSession { view: EditorView; loadEditor: jest.Mock; fake: ExportFake }

function openEditorSession(raw: string, options: { fake?: ExportFake; eol?: "\n" | "\r\n" } = {}): EditorSession {
  const fake = options.fake ?? toImagePlotly();
  const loadPlotly: PlotlyLoader = async () => fake.api;
  const loadEditor = jest.fn(loadChartEditor);
  const eol = options.eol ?? "\n";
  const doc = s.node("doc", { eol, trailing: "", unterminated: false }, [para(text("Before")), s.node("chart", { raw, gap: eol }), para(text("After"))]);
  const view = mount(doc, { chart: createChartView(loadPlotly, loadEditor) });
  return { view, loadEditor, fake };
}

function chartPos(view: EditorView): number {
  let found = -1;
  view.state.doc.forEach((node, offset) => { if (found < 0 && node.type.name === "chart") found = offset; });
  return found;
}

const chartNode = (view: EditorView): PmNode => view.state.doc.nodeAt(chartPos(view))!;
const rawOf = (view: EditorView): string => chartNode(view).attrs.raw as string;
const chartDom = (view: EditorView): HTMLElement => view.nodeDOM(chartPos(view)) as HTMLElement;

/** Clicks the innermost first element of the chart's view, so a handler on any ancestor sees it. */
function clickChart(view: EditorView): void {
  let target = chartDom(view);
  while (target.firstElementChild) target = target.firstElementChild as HTMLElement;
  target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

const editor = (): HTMLElement | null => document.querySelector<HTMLElement>(".ls-dialog-full");
const labelOf = (el: Element): string => (el.getAttribute("aria-label") ?? el.textContent ?? "").trim();

function button(name: string): HTMLButtonElement {
  const found = Array.from(editor()!.querySelectorAll<HTMLButtonElement>("button")).filter((b) => labelOf(b) === name);
  if (found.length !== 1) throw new Error(`expected one button named ${name}, found ${found.length}`);
  return found[0]!;
}

const settleEditor = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));

// Every test below needs the editor module the view loads, so each starts by loading it the way the view will.
beforeEach(async () => { await loadChartEditor(); });

afterEach(() => { document.body.innerHTML = ""; });

describe("chart node view opening the editor", () => {
  it("2.1a does not load the editor while the chart is only viewed", async () => {
    const session = openEditorSession(editorChartText(chartModel()));
    await until(() => session.fake.react.mock.calls.length > 0);
    await settleEditor();
    expect(session.loadEditor).not.toHaveBeenCalled();
    expect(editor()).toBeNull();
  });

  it("2.1a loads and opens the editor on click", async () => {
    const session = openEditorSession(editorChartText(chartModel()));
    clickChart(session.view);
    await until(() => editor() !== null);
    expect(session.loadEditor).toHaveBeenCalledTimes(1);
  });

  it("2.1a loads and opens the editor on Enter when the chart is the selected node", async () => {
    const session = openEditorSession(editorChartText(chartModel()));
    session.view.dispatch(session.view.state.tr.setSelection(NodeSelection.create(session.view.state.doc, chartPos(session.view))));
    chartDom(session.view).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await until(() => editor() !== null);
    expect(session.loadEditor).toHaveBeenCalledTimes(1);
  });

  it("2.1a does not open the editor of a read-only note on click", async () => {
    const session = openEditorSession(editorChartText(chartModel()));
    session.view.setProps({ editable: () => false });
    clickChart(session.view);
    await settleEditor(100);
    expect(session.loadEditor).not.toHaveBeenCalled();
    expect(editor()).toBeNull();
  });

  it("2.1a shows an 'Empty chart' placeholder for an empty chart and opens the editor on click", async () => {
    const session = openEditorSession("");
    expect(chartDom(session.view).textContent).toContain("Empty chart");
    clickChart(session.view);
    await until(() => editor() !== null);
    expect(session.loadEditor).toHaveBeenCalledTimes(1);
  });
});

describe("chart node view committing", () => {
  const model = chartModel({ title: "Growth" });

  it("2.1a Ok replaces the node's raw with formatChartBlock of the model and the PNG from toImage, and closes the editor", async () => {
    const original = editorChartText(model);
    const session = openEditorSession(original);
    clickChart(session.view);
    await until(() => editor() !== null);
    button("Ok").click();
    await until(() => rawOf(session.view) !== original);
    await settleEditor();
    const expected = formatChartBlock({ model, png: { dataUrl: DATA_URL, widthCm: 16, alt: "Growth" }, pgf: formatChartPgf(model, model.data ?? null) }, "\n");
    expect(expected).not.toBeNull();
    expect(rawOf(session.view)).toBe(expected + "\n");
    expect(session.fake.toImage).toHaveBeenCalledTimes(1);
    expect(editor()).toBeNull();
  });

  it("2.1a the written note body holds the new block between its paragraphs", async () => {
    const session = openEditorSession(editorChartText(model));
    clickChart(session.view);
    await until(() => editor() !== null);
    button("Ok").click();
    await until(() => session.fake.toImage.mock.calls.length > 0);
    await settleEditor();
    const block = readChartBlock(rawOf(session.view));
    expect(block?.model).toEqual(model);
    expect(block?.png?.dataUrl).toBe(DATA_URL);
    expect(docToBody(session.view.state.doc)).toContain(rawOf(session.view));
  });

  it("2.1a Apply writes the block and keeps the editor open", async () => {
    const original = editorChartText(model);
    const session = openEditorSession(original);
    clickChart(session.view);
    await until(() => editor() !== null);
    button("Apply").click();
    await until(() => rawOf(session.view) !== original);
    await settleEditor();
    expect(readChartBlock(rawOf(session.view))?.png?.dataUrl).toBe(DATA_URL);
    expect(editor()).not.toBeNull();
  });

  it("2.1a Cancel leaves the bytes unchanged and closes the editor", async () => {
    const original = editorChartText(model);
    const session = openEditorSession(original);
    const before = docToBody(session.view.state.doc);
    clickChart(session.view);
    await until(() => editor() !== null);
    button("Cancel").click();
    await settleEditor(100);
    expect(editor()).toBeNull();
    expect(rawOf(session.view)).toBe(original);
    expect(docToBody(session.view.state.doc)).toBe(before);
    expect(session.fake.toImage).not.toHaveBeenCalled();
  });

  it("2.1a Esc on the clean editor closes it and leaves the bytes unchanged", async () => {
    const original = editorChartText(model);
    const session = openEditorSession(original);
    clickChart(session.view);
    await until(() => editor() !== null);
    (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await settleEditor(100);
    expect(editor()).toBeNull();
    expect(rawOf(session.view)).toBe(original);
  });

  it("2.1a keeps a CRLF note's line ending in the new raw", async () => {
    const original = editorChartText(model, "\r\n");
    const session = openEditorSession(original, { eol: "\r\n" });
    clickChart(session.view);
    await until(() => editor() !== null);
    button("Ok").click();
    await until(() => rawOf(session.view) !== original);
    const raw = rawOf(session.view);
    expect(raw.endsWith("\r\n")).toBe(true);
    expect(raw.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("2.1a keeps a byte order mark at the start of the raw", async () => {
    const original = BOM + editorChartText(model);
    const session = openEditorSession(original);
    clickChart(session.view);
    await until(() => editor() !== null);
    button("Ok").click();
    await until(() => rawOf(session.view) !== original);
    expect(rawOf(session.view).startsWith(BOM)).toBe(true);
    expect(readChartBlock(rawOf(session.view).slice(1))?.png?.dataUrl).toBe(DATA_URL);
  });
});

describe("chart node view without an export image", () => {
  const model = chartModel({ title: "Growth" });

  it("2.1c writes the block without the PNG line when toImage rejects", async () => {
    const original = editorChartText(model);
    const session = openEditorSession(original, { fake: toImagePlotly(async () => { throw new Error("blocked by CSP"); }) });
    clickChart(session.view);
    await until(() => editor() !== null);
    button("Ok").click();
    await until(() => rawOf(session.view) !== original);
    await settleEditor();
    const raw = rawOf(session.view);
    expect(raw).not.toContain("![](");
    expect(readChartBlock(raw)?.png).toBeNull();
    expect(readChartBlock(raw)?.model).toEqual(model);
    expect(raw).toBe(formatChartBlock({ model, png: null, pgf: formatChartPgf(model, model.data ?? null) }, "\n") + "\n");
  });

  it("2.1c shows 'No image for export yet' in the chart's view", async () => {
    const original = editorChartText(model);
    const session = openEditorSession(original, { fake: toImagePlotly(async () => { throw new Error("blocked by CSP"); }) });
    clickChart(session.view);
    await until(() => editor() !== null);
    button("Ok").click();
    await until(() => rawOf(session.view) !== original);
    await settleEditor(100);
    expect(chartDom(session.view).textContent).toContain("No image for export yet");
  });

  it("2.1c does not show 'No image for export yet' for a chart written with its PNG", async () => {
    const original = editorChartText(model);
    const session = openEditorSession(original);
    clickChart(session.view);
    await until(() => editor() !== null);
    button("Ok").click();
    await until(() => rawOf(session.view) !== original);
    await settleEditor(100);
    expect(chartDom(session.view).textContent).not.toContain("No image for export yet");
  });
});
