/** @jest-environment jsdom */
// Spec 9.2c: charts in the HTML deck shell. The Chart entry of the insert bar and the Elements tab opens the figure editor and, when it
// reports a result with a png, adds one chart block as one "Insert block" step and selects it; the "Edit chart" button of the properties panel and
// a double-click on a chart block reopen the editor on the block's model and write one "Edit chart" step. The figure editor is faked: its chunk
// loader returns an editor whose openFigureEditor records the host, and the tests call host.done(...) themselves.
import { readDeckChart } from "../../../../../src/decks/deckCharts";
import { parseDeck } from "../../../../../src/decks/deckParse";
import { emptyFigure, readFigureModel, type FigureModel } from "../../../../../src/qmd/chart/index";
import type { FigureEditorHost, FigureEditorResult } from "../../../../../src/qmd/dom/figureEditor/index";
import { showToast } from "../../../../../src/ui/dom/widgets/toast";
import { DECK, POSTER, blockIds, buttonIn, host, lastChange, MOD, named, openWs, press, settle, toolbarOf, workspace } from "./shellHarness";

const mockEditor = { openFigureEditor: jest.fn() };
const mockLoadFigureEditor = jest.fn(async () => mockEditor);
const mockLoadCorePlotly = jest.fn();
const mockLoadCoreMath = jest.fn();

jest.mock("../../../../../src/qmd/dom/index", () => ({
  loadFigureEditor: (...args: unknown[]) => mockLoadFigureEditor(...(args as [])),
  loadCorePlotly: (...args: unknown[]) => mockLoadCorePlotly(...args),
  loadCoreMath: (...args: unknown[]) => mockLoadCoreMath(...args),
}));
jest.mock("../../../../../src/qmd/dom/figureEditor/index", () => ({ loadFigureEditor: (...args: unknown[]) => mockLoadFigureEditor(...(args as [])) }));
jest.mock("../../../../../src/ui/dom/widgets/toast", () => ({ showToast: jest.fn() }));

const PNG = "data:image/png;base64,iVBORw0KGgo=";
const PNG_2 = "data:image/png;base64,AAAAAAAA";
const TOO_LARGE = "Chart data is too large (keep it under 128 KB)";
const CANNOT_EDIT = "This chart cannot be edited";

const figure = (title: string, id = "c0ffee01"): FigureModel => ({ ...emptyFigure("data", id), title });
const resultOf = (model: FigureModel, dataUrl: string | null = PNG, alt = "Chart picture"): FigureEditorResult =>
  ({ model, png: dataUrl === null ? null : { dataUrl, widthCm: 12, alt }, picture: null, svg: null });
const SALES = figure("Sales");

const chartBlock = (id: string, model: string, png = PNG): string =>
  `<div data-block="${id}" data-chart="${model.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}" style="left: 600px; top: 200px; width: 600px; height: 400px;"><img src="${png}" alt="Sales chart" style="width: 100%; height: 100%; object-fit: contain;"></div>`;
const withChart = (id: string, model: string): string => DECK.replace("</section>", `${chartBlock(id, model)}\n</section>`);

const mockToast = jest.mocked(showToast);
const toastMessages = (): string[] => mockToast.mock.calls.map(([message]) => String(message));
const opened = (): FigureEditorHost[] => mockEditor.openFigureEditor.mock.calls.map(([hostArg]) => hostArg as FigureEditorHost);
const blocksOf = (html: string, slide = 0) => parseDeck(html).model!.slides[slide]!.blocks;
const chartIds = (html: string, slide = 0): string[] => blocksOf(html, slide).filter((block) => readDeckChart(html, block) !== null).map((block) => block.id);
const changesLabelled = (onChange: jest.Mock, label: string) => onChange.mock.calls.filter(([change]) => change.label === label);
const dblclick = (target: Element): void => {
  const view = target.ownerDocument.defaultView ?? window;
  target.dispatchEvent(new view.MouseEvent("dblclick", { bubbles: true, cancelable: true, clientX: 200, clientY: 150, button: 0 }));
};
const textButton = (text: string): HTMLButtonElement | undefined =>
  Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((candidate) => (candidate.textContent ?? "").trim() === text);
const menuItem = (label: string): HTMLElement | undefined =>
  Array.from(document.querySelectorAll<HTMLElement>("[role='menuitem']")).find((item) => (item.textContent ?? "").trim() === label);

beforeEach(() => {
  mockEditor.openFigureEditor.mockReset();
  mockLoadFigureEditor.mockClear();
  mockLoadCorePlotly.mockClear();
  mockLoadCoreMath.mockClear();
  mockToast.mockClear();
});

/** Opens the Chart entry of the insert bar and waits for the faked editor; returns the host it was opened with. */
async function openFromInsertBar(): Promise<FigureEditorHost> {
  const button = buttonIn(toolbarOf("Insert"), "Chart");
  expect(button).not.toBeNull();
  button!.click();
  await settle();
  expect(opened()).toHaveLength(1);
  return opened()[0]!;
}

describe("Chart in the insert bar", () => {
  it("9.2c the insert bar has a Chart button after Equation", async () => {
    await openWs();
    const labels = Array.from(toolbarOf("Insert")!.querySelectorAll<HTMLButtonElement>("button")).map((b) => b.getAttribute("aria-label"));
    expect(labels).toContain("Chart");
    expect(labels.indexOf("Chart")).toBe(labels.indexOf("Equation") + 1);
  });

  it("9.2c Chart opens the figure editor on a new figure of data or plot kind with no files port", async () => {
    await openWs();
    const editorHost = await openFromInsertBar();
    expect(editorHost.model).toBeNull();
    expect(editorHost.kinds).toEqual(["data", "plot"]);
    expect(editorHost.files).toBeUndefined();
    // The mocked qmd/dom/index exports wrappers around the mocks, so check the loaders by calling them.
    expect(mockLoadCorePlotly).not.toHaveBeenCalled();
    expect(mockLoadCoreMath).not.toHaveBeenCalled();
    await editorHost.loadPlotly();
    await editorHost.loadMath();
    expect(mockLoadCorePlotly).toHaveBeenCalledTimes(1);
    expect(mockLoadCoreMath).toHaveBeenCalledTimes(1);
  });

  it("9.2c opening the editor adds nothing before it reports a result", async () => {
    const onChange = await openWs();
    await openFromInsertBar();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("9.2c a result with a png adds one chart block as one Insert block step", async () => {
    const onChange = await openWs();
    const editorHost = await openFromInsertBar();
    editorHost.done(resultOf(SALES));
    await settle();
    expect(changesLabelled(onChange, "Insert block")).toHaveLength(1);
    expect(onChange).toHaveBeenCalledTimes(1);
    const html = lastChange(onChange).html;
    const added = chartIds(html);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatch(/^chart/);
    expect(blockIds(html)).toHaveLength(blockIds(DECK)!.length + 1);
    expect(parseDeck(html).problems).toEqual([]);
  });

  it("9.2c the new chart block holds the model and the png, with the model title as alt", async () => {
    const onChange = await openWs();
    const editorHost = await openFromInsertBar();
    editorHost.done(resultOf(SALES));
    await settle();
    const html = lastChange(onChange).html;
    const block = blocksOf(html).find((candidate) => candidate.id === chartIds(html)[0])!;
    const chart = readDeckChart(html, block)!;
    expect(JSON.parse(chart.model)).toEqual(JSON.parse(JSON.stringify(SALES)));
    expect(chart.png).toBe(PNG);
    expect(html).toContain('alt="Sales"');
  });

  it("9.2c a model without a title gives the alt Chart", async () => {
    const onChange = await openWs();
    const editorHost = await openFromInsertBar();
    const untitled = emptyFigure("data", "c0ffee02");
    editorHost.done(resultOf(untitled));
    await settle();
    expect(lastChange(onChange).html).toContain('alt="Chart"');
  });

  it("9.2c the new chart block is selected", async () => {
    await openWs();
    expect(named("Resize se")).toBeNull();
    const editorHost = await openFromInsertBar();
    editorHost.done(resultOf(SALES));
    await settle();
    expect(named("Resize se")).not.toBeNull();
  });

  it("9.2c a second chart gets a different id", async () => {
    const onChange = await openWs();
    (await openFromInsertBar()).done(resultOf(SALES));
    await settle();
    mockEditor.openFigureEditor.mockReset();
    (await openFromInsertBar()).done(resultOf(figure("Costs", "c0ffee03"), PNG_2));
    await settle();
    expect(new Set(chartIds(lastChange(onChange).html)).size).toBe(2);
  });

  it("9.2c one undo removes the inserted chart", async () => {
    const onChange = await openWs();
    (await openFromInsertBar()).done(resultOf(SALES));
    await settle();
    press("z", MOD);
    await settle();
    expect(lastChange(onChange).label).toBe("Undo");
    expect(chartIds(lastChange(onChange).html)).toEqual([]);
  });

  it("9.2c a null result adds nothing", async () => {
    const onChange = await openWs();
    (await openFromInsertBar()).done(null);
    await settle();
    expect(onChange).not.toHaveBeenCalled();
    expect(mockToast).not.toHaveBeenCalled();
  });

  it("9.2c a result without a png adds nothing", async () => {
    const onChange = await openWs();
    (await openFromInsertBar()).done(resultOf(SALES, null));
    await settle();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("9.2c a too-large model shows a toast with the error and adds nothing", async () => {
    const onChange = await openWs();
    (await openFromInsertBar()).done(resultOf(figure("x".repeat(140000))));
    await settle();
    expect(onChange).not.toHaveBeenCalled();
    expect(toastMessages().some((message) => message.includes(TOO_LARGE))).toBe(true);
  });
});

describe("Chart in the Elements tab", () => {
  it("9.2c the Add element menu of a talk has Chart, which opens the figure editor and inserts one chart block", async () => {
    const onChange = await openWs();
    Array.from(host.querySelectorAll<HTMLElement>("[role='tab']")).find((tab) => tab.textContent === "Elements")!.click();
    await settle();
    textButton("Add element")!.click();
    await settle();
    expect(menuItem("Chart")).toBeDefined();
    menuItem("Chart")!.click();
    await settle();
    expect(opened()).toHaveLength(1);
    expect(opened()[0]!.model).toBeNull();
    opened()[0]!.done(resultOf(SALES));
    await settle();
    expect(changesLabelled(onChange, "Insert block")).toHaveLength(1);
    expect(chartIds(lastChange(onChange).html)).toHaveLength(1);
    expect(named("Resize se")).not.toBeNull();
  });

  it("9.2c the Elements tab of a poster has a Chart entry that inserts one chart block", async () => {
    const onChange = await openWs(POSTER);
    Array.from(host.querySelectorAll<HTMLElement>("[role='tab']")).find((tab) => tab.textContent === "Elements")!.click();
    await settle();
    const entry = Array.from(host.querySelectorAll<HTMLElement>(".dsh-palette-item")).find((item) => (item.textContent ?? "").trim() === "Chart");
    expect(entry).toBeDefined();
    entry!.click();
    await settle();
    expect(opened()).toHaveLength(1);
    opened()[0]!.done(resultOf(SALES));
    await settle();
    expect(changesLabelled(onChange, "Insert block")).toHaveLength(1);
    expect(chartIds(lastChange(onChange).html)).toHaveLength(1);
  });

  it("9.2c a null result from the Elements tab adds nothing", async () => {
    const onChange = await openWs(POSTER);
    Array.from(host.querySelectorAll<HTMLElement>("[role='tab']")).find((tab) => tab.textContent === "Elements")!.click();
    await settle();
    Array.from(host.querySelectorAll<HTMLElement>(".dsh-palette-item")).find((item) => (item.textContent ?? "").trim() === "Chart")!.click();
    await settle();
    opened()[0]!.done(null);
    await settle();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("Edit chart", () => {
  const model = JSON.stringify(SALES);
  const open = async () => {
    const onChange = await openWs(withChart("chart-1", model));
    workspace!.selectBlocks(["chart-1"]);
    await settle();
    return onChange;
  };

  it("9.2c a selected chart block has an Edit chart button in its properties", async () => {
    await open();
    expect(textButton("Edit chart")).toBeDefined();
  });

  it("9.2c an image block has no Edit chart button", async () => {
    await openWs(DECK.replace("</section>", '<div data-block="pic" style="left: 600px; top: 200px; width: 600px; height: 400px;"><img src="assets/a.png" alt="" style="width: 100%; height: 100%; object-fit: contain;"></div>\n</section>'));
    workspace!.selectBlocks(["pic"]);
    await settle();
    expect(textButton("Edit chart")).toBeUndefined();
  });

  it("9.2c Edit chart opens the figure editor with the block's model", async () => {
    await open();
    textButton("Edit chart")!.click();
    await settle();
    expect(opened()).toHaveLength(1);
    expect(opened()[0]!.model).toEqual(readFigureModel(JSON.parse(model)));
    expect(opened()[0]!.kinds).toEqual(["data", "plot"]);
  });

  it("9.2c a result from Edit chart writes one Edit chart step that replaces the model and the png", async () => {
    const onChange = await open();
    textButton("Edit chart")!.click();
    await settle();
    const next = figure("Revenue");
    opened()[0]!.done(resultOf(next, PNG_2));
    await settle();
    expect(changesLabelled(onChange, "Edit chart")).toHaveLength(1);
    expect(onChange).toHaveBeenCalledTimes(1);
    const html = lastChange(onChange).html;
    const chart = readDeckChart(html, blocksOf(html).find((block) => block.id === "chart-1")!)!;
    expect(JSON.parse(chart.model)).toEqual(JSON.parse(JSON.stringify(next)));
    expect(chart.png).toBe(PNG_2);
    expect(blockIds(html)).toEqual(blockIds(withChart("chart-1", model)));
  });

  it("9.2c the Edit chart step keeps the block's position and size", async () => {
    const onChange = await open();
    textButton("Edit chart")!.click();
    await settle();
    opened()[0]!.done(resultOf(figure("Revenue"), PNG_2));
    await settle();
    const html = lastChange(onChange).html;
    expect(blocksOf(html).find((block) => block.id === "chart-1")!.rect).toEqual({ left: 600, top: 200, width: 600, height: 400 });
  });

  it("9.2c one undo reverts the Edit chart step", async () => {
    const onChange = await open();
    const before = withChart("chart-1", model);
    textButton("Edit chart")!.click();
    await settle();
    opened()[0]!.done(resultOf(figure("Revenue"), PNG_2));
    await settle();
    press("z", MOD);
    await settle();
    expect(lastChange(onChange).label).toBe("Undo");
    expect(lastChange(onChange).html).toBe(before);
  });

  it("9.2c a double-click on a chart block opens the editor with its model", async () => {
    await openWs(withChart("chart-1", model));
    dblclick(named("Block chart-1")!);
    await settle();
    expect(opened()).toHaveLength(1);
    expect(opened()[0]!.model).toEqual(readFigureModel(JSON.parse(model)));
  });

  it("9.2c a result after a double-click writes one Edit chart step", async () => {
    const onChange = await openWs(withChart("chart-1", model));
    dblclick(named("Block chart-1")!);
    await settle();
    opened()[0]!.done(resultOf(figure("Revenue"), PNG_2));
    await settle();
    expect(changesLabelled(onChange, "Edit chart")).toHaveLength(1);
    expect(onChange).toHaveBeenCalledTimes(1);
    const html = lastChange(onChange).html;
    expect(readDeckChart(html, blocksOf(html).find((block) => block.id === "chart-1")!)!.png).toBe(PNG_2);
  });

  it("9.2c a null result from Edit chart changes nothing", async () => {
    const onChange = await open();
    textButton("Edit chart")!.click();
    await settle();
    opened()[0]!.done(null);
    await settle();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("9.2c an unreadable model shows the toast This chart cannot be edited and opens nothing from the button", async () => {
    const onChange = await openWs(withChart("chart-1", "not json {"));
    workspace!.selectBlocks(["chart-1"]);
    await settle();
    textButton("Edit chart")!.click();
    await settle();
    expect(toastMessages()).toContain(CANNOT_EDIT);
    expect(mockEditor.openFigureEditor).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("9.2c an unreadable model shows the toast and opens nothing on a double-click", async () => {
    const onChange = await openWs(withChart("chart-1", JSON.stringify({ v: 2 })));
    dblclick(named("Block chart-1")!);
    await settle();
    expect(toastMessages()).toContain(CANNOT_EDIT);
    expect(mockEditor.openFigureEditor).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("9.2c a too-large model from Edit chart shows a toast and writes nothing", async () => {
    const onChange = await open();
    textButton("Edit chart")!.click();
    await settle();
    opened()[0]!.done(resultOf(figure("x".repeat(140000)), PNG_2));
    await settle();
    expect(onChange).not.toHaveBeenCalled();
    expect(toastMessages().some((message) => message.includes(TOO_LARGE))).toBe(true);
  });
});

describe("charts can be inserted and edited", () => {
  it("A9 a chart is inserted from the insert bar and edited from its properties as two undo steps", async () => {
    const onChange = await openWs();
    (await openFromInsertBar()).done(resultOf(SALES));
    await settle();
    const inserted = chartIds(lastChange(onChange).html)[0]!;
    expect(inserted).toBeDefined();
    expect(changesLabelled(onChange, "Insert block")).toHaveLength(1);

    mockEditor.openFigureEditor.mockReset();
    textButton("Edit chart")!.click();
    await settle();
    expect(opened()).toHaveLength(1);
    expect(opened()[0]!.model).toEqual(readFigureModel(JSON.parse(JSON.stringify(SALES))));
    opened()[0]!.done(resultOf(figure("Revenue"), PNG_2));
    await settle();
    expect(changesLabelled(onChange, "Edit chart")).toHaveLength(1);
    const html = lastChange(onChange).html;
    const chart = readDeckChart(html, blocksOf(html).find((block) => block.id === inserted)!)!;
    expect(JSON.parse(chart.model).title).toBe("Revenue");
    expect(chart.png).toBe(PNG_2);

    press("z", MOD);
    await settle();
    expect(JSON.parse(readDeckChart(lastChange(onChange).html, blocksOf(lastChange(onChange).html).find((block) => block.id === inserted)!)!.model).title).toBe("Sales");
    press("z", MOD);
    await settle();
    expect(chartIds(lastChange(onChange).html)).toEqual([]);
  });

  it("A9 a chart in a deck opens for editing by a double-click and its edit is written to the block", async () => {
    const start = withChart("chart-1", JSON.stringify(SALES));
    const onChange = await openWs(start);
    dblclick(named("Block chart-1")!);
    await settle();
    const next = resultOf(figure("Revenue"), PNG_2);
    opened()[0]!.done(next);
    await settle();
    const html = lastChange(onChange).html;
    const block = blocksOf(html).find((candidate) => candidate.id === "chart-1")!;
    expect(readDeckChart(html, block)!.png).toBe(PNG_2);
    expect(JSON.parse(readDeckChart(html, block)!.model)).toEqual(JSON.parse(JSON.stringify(next.model)));
  });
});
