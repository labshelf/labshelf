/** @jest-environment jsdom */
/**
 * Tests spec 2.2 of plan charts (D9): the chart picker of the chart editor. chartTiles lists the 12 tiles in Mathcha's order,
 * renderChartPicker draws them as labelled controls that arrow keys move between, Enter picks and a click picks; and, through
 * openChartEditor with a null model, picking a tile makes the empty chart of that tile's kind and first trace type.
 * Written as if the file sat at packages/core/__tests__/qmd/dom/chartEditor/picker.test.ts.
 */
import { chartTiles, renderChartPicker } from "../../../../src/qmd/dom/chartEditor/picker";
import { openChartEditor, type ChartEditorHost } from "../../../../src/qmd/dom/chartEditor/openChartEditor";
import type { PlotlyApi } from "../../../../src/qmd/dom/plotView";
import { renderIcon } from "../../../../src/ui/icons/index";
import { fakePlotly } from "../plotViewHarness";
import { until } from "../../../support/nodeViewHarness";

const LABELS = ["Function Plot", "Function 3d Plot", "Scatter", "Line", "Area", "Contour", "Heatmap", "Pie", "Bar", "Surface 3d", "Scatter 3d", "Mesh 3d"];
const PNG = "iVBORw0KGgoAAAANSUhEUgAAACgAAAAUCAIAAABwJOjsAAAAJElEQVR4nGNoaPg/IIhh1OJRi0ctHrV41OJRi0ctHrV45FgMAPGJPTtbDo1MAAAAAElFTkSuQmCC";
const DATA_URL = `data:image/png;base64,${PNG}`;

const TILE_SELECTOR = 'button, [role="button"], [role="option"], [role="radio"], [role="gridcell"], [role="menuitem"]';
/** The control labelled exactly `label` (by its text or its aria-label) under `root`. */
function tile(root: ParentNode, label: string): HTMLElement | undefined {
  return [...root.querySelectorAll<HTMLElement>(TILE_SELECTOR)].find((el) => (el.getAttribute("aria-label") ?? el.textContent ?? "").trim() === label)
    ?? [...root.querySelectorAll<HTMLElement>(TILE_SELECTOR)].find((el) => (el.textContent ?? "").trim() === label);
}
const tilesIn = (root: ParentNode): HTMLElement[] => LABELS.map((label) => {
  const hit = tile(root, label);
  if (!hit) throw new Error(`no tile ${label}`);
  return hit;
});
const keydown = (target: Element, key: string): void => {
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("chartTiles", () => {
  it("2.2b lists 12 tiles", () => {
    expect(chartTiles()).toHaveLength(12);
  });

  it("2.2b lists them in Mathcha's order with these words", () => {
    expect(chartTiles().map((t) => t.label)).toEqual(LABELS);
  });

  it("2.2b gives every tile a unique id and a glyph that renders", () => {
    expect(new Set(chartTiles().map((t) => t.id)).size).toBe(12);
    for (const t of chartTiles()) expect(renderIcon(t.icon)).toContain("<");
  });

  it("2.2b makes Function Plot a fn2d chart and Function 3d Plot a fn3d chart, and every other tile a data chart", () => {
    const kinds = Object.fromEntries(chartTiles().map((t) => [t.label, t.kind]));
    expect(kinds["Function Plot"]).toBe("fn2d");
    expect(kinds["Function 3d Plot"]).toBe("fn3d");
    for (const label of LABELS.slice(2)) expect(kinds[label]).toBe("data");
  });
});

describe("renderChartPicker", () => {
  it("2.2b draws 12 labelled tiles, one per label", () => {
    const picker = renderChartPicker(() => undefined);
    document.body.append(picker);
    expect(tilesIn(picker)).toHaveLength(12);
    expect(new Set(tilesIn(picker)).size).toBe(12);
  });

  it("2.2b shows each tile's icon", () => {
    const picker = renderChartPicker(() => undefined);
    document.body.append(picker);
    for (const el of tilesIn(picker)) expect(el.querySelector("svg")).not.toBeNull();
  });

  it("2.2b calls onPick with the tile when it is clicked", () => {
    const onPick = jest.fn();
    const picker = renderChartPicker(onPick);
    document.body.append(picker);
    tile(picker, "Line")!.click();
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0]![0]).toEqual(chartTiles().find((t) => t.label === "Line"));
  });

  it("2.2b moves focus to the next tile on ArrowRight and back on ArrowLeft", () => {
    const picker = renderChartPicker(() => undefined);
    document.body.append(picker);
    const tiles = tilesIn(picker);
    tiles[0]!.focus();
    keydown(document.activeElement!, "ArrowRight");
    expect(document.activeElement).toBe(tiles[1]);
    keydown(document.activeElement!, "ArrowRight");
    expect(document.activeElement).toBe(tiles[2]);
    keydown(document.activeElement!, "ArrowLeft");
    expect(document.activeElement).toBe(tiles[1]);
  });

  it("2.2b moves focus down a row on ArrowDown and back up on ArrowUp", () => {
    const picker = renderChartPicker(() => undefined);
    document.body.append(picker);
    const tiles = tilesIn(picker);
    tiles[0]!.focus();
    keydown(document.activeElement!, "ArrowDown");
    const lower = document.activeElement;
    expect(lower).not.toBe(tiles[0]);
    expect(tiles).toContain(lower);
    keydown(document.activeElement!, "ArrowUp");
    expect(document.activeElement).toBe(tiles[0]);
  });

  it("2.2b picks the focused tile on Enter", () => {
    const onPick = jest.fn();
    const picker = renderChartPicker(onPick);
    document.body.append(picker);
    const tiles = tilesIn(picker);
    tiles[0]!.focus();
    keydown(document.activeElement!, "ArrowRight");
    keydown(document.activeElement!, "ArrowRight");
    keydown(document.activeElement!, "ArrowRight");
    expect(document.activeElement).toBe(tiles[3]);
    keydown(document.activeElement!, "Enter");
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0]![0].label).toBe("Line");
  });

  it("2.2b does not pick anything on an arrow key", () => {
    const onPick = jest.fn();
    const picker = renderChartPicker(onPick);
    document.body.append(picker);
    tilesIn(picker)[0]!.focus();
    keydown(document.activeElement!, "ArrowRight");
    expect(onPick).not.toHaveBeenCalled();
  });
});

describe("the picker in the chart editor", () => {
  type Done = ChartEditorHost["done"];
  const dialog = (): HTMLElement | null => document.querySelector<HTMLElement>(".ls-dialog-full");
  const button = (label: RegExp): HTMLButtonElement | undefined =>
    [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => label.test((b.textContent ?? "").trim()));
  const closers: Array<{ close(): void }> = [];

  function setup(): { done: jest.Mock; toImage: jest.Mock } {
    const f = fakePlotly();
    const toImage = jest.fn(async () => DATA_URL);
    const api = { ...f.api, toImage, newPlot: jest.fn(async () => undefined) } as unknown as PlotlyApi;
    const done = jest.fn();
    closers.push(openChartEditor({ model: null, loadPlotly: async () => api, done: done as unknown as Done }));
    return { done, toImage };
  }
  afterEach(() => {
    while (closers.length > 0) { try { closers.pop()!.close(); } catch { /* already closed */ } }
  });

  /** Opens the editor on a null model, picks `label`, presses Ok and returns the model it hands to done. */
  async function pickAndOk(label: string): Promise<{ model: { kind: string; traces: Array<{ type: string; mode?: string }>; fns: unknown[]; v: number; id: string }; png: unknown }> {
    const { done } = setup();
    await until(() => dialog() !== null && tile(dialog()!, label) !== undefined);
    tile(dialog()!, label)!.click();
    await until(() => button(/^ok$/i) !== undefined);
    button(/^ok$/i)!.click();
    await until(() => done.mock.calls.length > 0);
    return done.mock.calls[0]![0];
  }

  it("2.2b shows the 12 tiles when the editor opens on a null model", async () => {
    setup();
    await until(() => dialog() !== null && LABELS.every((label) => tile(dialog()!, label) !== undefined));
    expect(tilesIn(dialog()!)).toHaveLength(12);
  });

  it("2.2b picking Line makes a data chart whose first trace is scatter with mode lines", async () => {
    const result = await pickAndOk("Line");
    expect(result.model.kind).toBe("data");
    expect(result.model.v).toBe(1);
    expect(result.model.traces[0]!.type).toBe("scatter");
    expect(result.model.traces[0]!.mode).toBe("lines");
  });

  it("2.2b picking Function Plot makes a fn2d chart", async () => {
    expect((await pickAndOk("Function Plot")).model.kind).toBe("fn2d");
  });

  it("2.2b picking Function 3d Plot makes a fn3d chart", async () => {
    expect((await pickAndOk("Function 3d Plot")).model.kind).toBe("fn3d");
  });

  it.each([
    ["Scatter", "scatter"],
    ["Area", "scatter"],
    ["Contour", "contour"],
    ["Heatmap", "heatmap"],
    ["Pie", "pie"],
    ["Bar", "bar"],
    ["Surface 3d", "surface"],
    ["Scatter 3d", "scatter3d"],
    ["Mesh 3d", "mesh3d"],
  ])("2.2b picking %s makes a data chart whose first trace type is %s", async (label, type) => {
    const result = await pickAndOk(label);
    expect(result.model.kind).toBe("data");
    expect(result.model.traces[0]!.type).toBe(type);
  });

  it("2.2b gives each picked chart a fresh id", async () => {
    const first = await pickAndOk("Line");
    document.body.innerHTML = "";
    const second = await pickAndOk("Bar");
    expect(first.model.id).toMatch(/^[0-9a-f]{8}$/);
    expect(second.model.id).not.toBe(first.model.id);
  });
});
