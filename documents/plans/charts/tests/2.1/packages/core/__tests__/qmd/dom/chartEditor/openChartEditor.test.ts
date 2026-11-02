/** @jest-environment jsdom */
/**
 * Tests openChartEditor (plan charts, D6, D9, 2.1): the fullscreen overlay with Cancel / Apply / Ok, the result handed to
 * `done` (the model and a PNG from the fake Plotly.toImage, or no PNG when it rejects), and the Esc order: leave an open field,
 * ask before discarding a dirty editor, close a clean one. Plotly is a fake and nothing real is loaded.
 *
 * ASSUMPTION (the spec names no control that edits in 2.1): the tests make the editor dirty by changing a form control inside the
 * editor and dispatching a bubbling `input` event from it, and they add that control to the editor themselves.
 */
import type { ChartModel, ChartTable } from "../../../../src/qmd/chart/model";
import { loadChartEditor } from "../../../../src/qmd/dom/chartEditor/index";
import { openChartEditor, type ChartEditorHost } from "../../../../src/qmd/dom/chartEditor/openChartEditor";
import type { PlotlyApi, PlotlyLoader } from "../../../../src/qmd/dom/plotView";

const DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAUCAIAAABwJOjsAAAAJElEQVR4nGNoaPg/IIhh1OJRi0ctHrV41OJRi0ctHrV45FgMAPGJPTtbDo1MAAAAAElFTkSuQmCC";
const DISCARD = "Discard changes to this chart?";

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

type Result = Parameters<ChartEditorHost["done"]>[0];
type Written = NonNullable<Result>;

interface Fake { api: PlotlyApi; react: jest.Mock; purge: jest.Mock; toImage: jest.Mock }

function fakePlotly(toImage: (root: HTMLElement, options: object) => Promise<string> = async () => DATA_URL): Fake {
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

const settle = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("condition not met in time");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

let handle: { close(): void } | undefined;
afterEach(() => {
  handle?.close();
  handle = undefined;
  document.body.innerHTML = "";
});

interface Session { done: jest.Mock<void, [Result]>; fake: Fake }

function open(model: ChartModel | null = chartModel({ title: "Growth" }), fake: Fake = fakePlotly()): Session {
  const done = jest.fn<void, [Result]>();
  const loadPlotly: PlotlyLoader = async () => fake.api;
  handle = openChartEditor({ model, loadPlotly, done });
  return { done, fake };
}

const editor = (): HTMLElement | null => document.querySelector<HTMLElement>(".ls-dialog-full");
const isOpen = (): boolean => editor() !== null && editor()!.isConnected;
const labelOf = (el: Element): string => (el.getAttribute("aria-label") ?? el.textContent ?? "").trim();

function button(name: string, within: ParentNode = editor() ?? document.body): HTMLButtonElement {
  const found = Array.from(within.querySelectorAll<HTMLButtonElement>("button")).filter((b) => labelOf(b) === name);
  if (found.length !== 1) throw new Error(`expected one button named ${name}, found ${found.length}`);
  return found[0]!;
}

/** The discard confirm: the dialog that is not the editor and holds the question. */
function confirm(): HTMLElement | null {
  const boxes = Array.from(document.querySelectorAll<HTMLElement>(".ls-dialog:not(.ls-dialog-full)"));
  return boxes.find((box) => (box.textContent ?? "").includes(DISCARD)) ?? null;
}

const pressEscape = (): void => {
  (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
};

/** Adds a text field to the editor, focuses it and returns it. */
function addField(): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "text";
  input.setAttribute("aria-label", "Test field");
  editor()!.append(input);
  input.focus();
  return input;
}

/** Edits the field the way a user does: a new value and a bubbling input event; then focus leaves the field. */
function dirty(input: HTMLInputElement): void {
  input.value = "changed";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  input.blur();
}

const written = (done: jest.Mock<void, [Result]>): Written[] => done.mock.calls.map((call) => call[0]).filter((result): result is Written => result !== null);

describe("loadChartEditor", () => {
  it("2.1a loads the module that exports openChartEditor", async () => {
    const module = await loadChartEditor();
    expect(typeof module.openChartEditor).toBe("function");
  });
});

describe("openChartEditor writing", () => {
  it("2.1a opens a fullscreen overlay with Cancel, Apply and Ok buttons", () => {
    open();
    expect(isOpen()).toBe(true);
    expect(button("Cancel")).toBeDefined();
    expect(button("Apply")).toBeDefined();
    expect(button("Ok")).toBeDefined();
  });

  it("2.1a Ok calls done once with the model and the PNG the fake toImage gave, then closes", async () => {
    const model = chartModel({ title: "Growth" });
    const { done } = open(model);
    button("Ok").click();
    await until(() => done.mock.calls.length > 0);
    await settle();
    expect(done).toHaveBeenCalledTimes(1);
    expect(done.mock.calls[0]![0]).toEqual({ model, png: { dataUrl: DATA_URL, widthCm: 16, alt: "Growth" } });
    expect(isOpen()).toBe(false);
  });

  it("2.1a names the PNG after the kind when the chart has no title", async () => {
    const { done } = open(chartModel());
    button("Ok").click();
    await until(() => done.mock.calls.length > 0);
    expect(written(done)[0]!.png!.alt).toBe("Data chart");
  });

  it("2.1a takes the PNG from the figure drawn offscreen at 640x400 px, scale 2", async () => {
    const { done, fake } = open();
    button("Ok").click();
    await until(() => done.mock.calls.length > 0);
    expect(fake.toImage).toHaveBeenCalledTimes(1);
    const [root, options] = fake.toImage.mock.calls[0] as [HTMLElement, object];
    expect(root.isConnected).toBe(false);
    expect(options).toEqual({ format: "png", width: 640, height: 400, scale: 2 });
  });

  it("2.1a Apply writes and keeps the editor open, and a later Ok writes again", async () => {
    const { done } = open();
    button("Apply").click();
    await until(() => done.mock.calls.length > 0);
    await settle();
    expect(written(done)).toHaveLength(1);
    expect(written(done)[0]!.png?.dataUrl).toBe(DATA_URL);
    expect(isOpen()).toBe(true);
    button("Ok").click();
    await until(() => done.mock.calls.length > 1);
    await settle();
    expect(isOpen()).toBe(false);
  });

  it("2.1a Cancel closes without writing", async () => {
    const { done } = open();
    button("Cancel").click();
    await settle();
    expect(isOpen()).toBe(false);
    expect(written(done)).toHaveLength(0);
  });

  it("2.1a close() removes the editor without writing", async () => {
    const { done } = open();
    handle!.close();
    await settle();
    expect(isOpen()).toBe(false);
    expect(written(done)).toHaveLength(0);
  });

  it("2.1a opens for a null model with a Cancel that closes it without writing", async () => {
    const { done } = open(null);
    expect(isOpen()).toBe(true);
    button("Cancel").click();
    await settle();
    expect(isOpen()).toBe(false);
    expect(written(done)).toHaveLength(0);
  });

  it("2.1c Ok writes the model with no PNG when toImage rejects", async () => {
    const model = chartModel({ title: "Growth" });
    const { done } = open(model, fakePlotly(async () => { throw new Error("blocked by CSP"); }));
    button("Ok").click();
    await until(() => done.mock.calls.length > 0);
    await settle();
    expect(done).toHaveBeenCalledTimes(1);
    expect(done.mock.calls[0]![0]).toEqual({ model, png: null });
    expect(isOpen()).toBe(false);
  });
});

describe("openChartEditor Esc", () => {
  it("2.1b Esc on a clean editor closes it without asking and without writing", async () => {
    const { done } = open();
    pressEscape();
    await settle();
    expect(isOpen()).toBe(false);
    expect(confirm()).toBeNull();
    expect(written(done)).toHaveLength(0);
  });

  it("2.1b Esc inside an open field leaves the field and keeps the editor", async () => {
    const { done } = open();
    const field = addField();
    expect(document.activeElement).toBe(field);
    pressEscape();
    await settle();
    expect(isOpen()).toBe(true);
    expect(document.activeElement).not.toBe(field);
    expect(confirm()).toBeNull();
    expect(written(done)).toHaveLength(0);
  });

  it("2.1b a second Esc, with no field open, closes the clean editor", async () => {
    open();
    addField();
    pressEscape();
    await settle();
    expect(isOpen()).toBe(true);
    pressEscape();
    await settle();
    expect(isOpen()).toBe(false);
  });

  it("2.1b Esc inside a field of a dirty editor leaves the field without asking yet", async () => {
    open();
    const field = addField();
    field.value = "changed";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    pressEscape();
    await settle();
    expect(isOpen()).toBe(true);
    expect(confirm()).toBeNull();
    expect(document.activeElement).not.toBe(field);
  });

  it("2.1b Esc on a dirty editor asks 'Discard changes to this chart?' and keeps the editor open", async () => {
    const { done } = open();
    dirty(addField());
    pressEscape();
    await until(() => confirm() !== null);
    expect(isOpen()).toBe(true);
    expect(written(done)).toHaveLength(0);
  });

  it("2.1b Esc in the discard confirm closes only the confirm", async () => {
    open();
    dirty(addField());
    pressEscape();
    await until(() => confirm() !== null);
    pressEscape();
    await until(() => confirm() === null);
    await settle();
    expect(isOpen()).toBe(true);
  });

  it("2.1b cancelling the discard confirm keeps the editor open", async () => {
    open();
    dirty(addField());
    pressEscape();
    await until(() => confirm() !== null);
    button("Cancel", confirm()!).click();
    await until(() => confirm() === null);
    await settle();
    expect(isOpen()).toBe(true);
  });

  it("2.1b accepting the discard confirm closes the editor without writing", async () => {
    const { done } = open();
    dirty(addField());
    pressEscape();
    await until(() => confirm() !== null);
    confirm()!.querySelector<HTMLElement>(".ls-btn-primary")!.click();
    await until(() => !isOpen());
    expect(confirm()).toBeNull();
    expect(written(done)).toHaveLength(0);
  });

  it("2.1b a scrim mousedown does not dismiss the fullscreen editor", async () => {
    open();
    document.querySelector(".ls-scrim")?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await settle();
    expect(isOpen()).toBe(true);
  });
});

describe("openChartEditor focus trap", () => {
  const CONTROLS = "input, button:not(:disabled), select, textarea, a[href], [tabindex]";

  it.each([
    ["select", () => document.createElement("select")],
    ["textarea", () => document.createElement("textarea")],
    ["link", () => Object.assign(document.createElement("a"), { href: "https://example.org/" })],
  ])("2.1b wraps Tab from a last %s of the editor back to its first control", (_name, make) => {
    open();
    const last = make();
    last.setAttribute("aria-label", "Test control");
    editor()!.append(last);
    const first = editor()!.querySelector<HTMLElement>(CONTROLS)!;
    expect(first).not.toBe(last);
    last.focus();
    const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    last.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);
  });
});
