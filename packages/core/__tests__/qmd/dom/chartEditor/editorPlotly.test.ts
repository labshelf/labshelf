/** @jest-environment jsdom */
/**
 * Tests mountFnEditor (plan charts, spec 5.3, D9, A7): the function plot dialog body. Tabs Expressions / Axes / X Axis / Y Axis, a "+ Add" menu of kinds,
 * rows with a relation dropdown, live-validated expression fields, "Variables +" with a slider, and a preview with Zoom + / Zoom − / View full.
 * The DOM is new, so controls are found by accessible name or visible text and by the one class the spec fixes (is-invalid), never by invented class names.
 * Model effects are read from onChange; preview redraws from the fake Plotly (its react mock); frames are queued by hand.
 */
import { parseExpr } from "../../../../src/drawing/expr";
import { emptyChart, type ChartFn, type ChartModel, type ChartVar } from "../../../../src/qmd/chart/model";
import { mountFnEditor } from "../../../../src/qmd/dom/chartEditor/fnEditor";
import { closeMenu } from "../../../../src/ui/dom/widgets/menu";
import { fakePlotly } from "../plotViewHarness";
import { controls, fakeFrames, setChoice, settle, type Frames } from "./chartEditorHarness";

type Anything = Record<string, unknown>;

function fnModel(fns: ChartFn[] = [], vars: ChartVar[] = []): ChartModel {
  return { ...emptyChart("fn2d", "a1b2c3d4"), fns, vars };
}

let frames: Frames;
let roots: HTMLElement[] = [];
let destroyers: (() => void)[] = [];

interface Editor {
  root: HTMLElement;
  fake: ReturnType<typeof fakePlotly>;
  calls: ChartModel[];
  last(): ChartModel;
}

function mount(model: ChartModel): Editor {
  const root = document.createElement("div");
  document.body.append(root);
  roots.push(root);
  const fake = fakePlotly();
  // Plotly keeps the laid-out axis ranges on the element it drew into, and the preview zooms from them; a real draw does, so the fake does too.
  fake.react.mockImplementation((el: HTMLElement, data: readonly object[], layout?: object) => {
    (el as unknown as { _fullLayout: unknown })._fullLayout = { xaxis: { range: [-10, 10] }, yaxis: { range: [-10, 10] } };
    (el as unknown as { data: unknown; layout: unknown }).data = data;
    (el as unknown as { layout: unknown }).layout = layout;
    return Promise.resolve();
  });
  const calls: ChartModel[] = [];
  const handle = mountFnEditor(root, model, (next) => { calls.push(next); }, async () => fake.api, 2);
  destroyers.push(() => handle.destroy());
  return { root, fake, calls, last: () => calls[calls.length - 1]! };
}

beforeEach(() => { frames = fakeFrames(); });
afterEach(() => {
  closeMenu();
  for (const d of destroyers) d();
  destroyers = [];
  for (const r of roots) r.remove();
  roots = [];
  frames.restore();
});

function addButton(root: HTMLElement): HTMLElement {
  const found = controls(root, /^\+\s*add$/i)[0];
  if (found === undefined) throw new Error("no + Add button");
  return found;
}

function addFn(root: HTMLElement, kind: string): void {
  setChoice(addButton(root), kind);
}

function tab(root: HTMLElement, name: RegExp): HTMLElement {
  const all = controls(root, name);
  const found = all.find((el) => el.getAttribute("role") === "tab") ?? all[0];
  if (found === undefined) throw new Error(`no tab ${String(name)}`);
  return found;
}

const NOT_EXPR = /variable|title|\bvalue\b|\bmin\b|\bmax\b|\bstep|\bname\b/i;

/** The shown free-text fields that can hold an expression: text inputs and textareas, in document order. */
function exprFields(root: HTMLElement): (HTMLInputElement | HTMLTextAreaElement)[] {
  const all = controls(root, /.*/).filter((el): el is HTMLInputElement | HTMLTextAreaElement => el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && (el.type === "text" || el.type === "")));
  return all.filter((el) => !NOT_EXPR.test(el.getAttribute("aria-label") ?? ""));
}

function commit(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function typeInto(root: HTMLElement, nth: number, value: string): void {
  const field = exprFields(root)[nth];
  if (field === undefined) throw new Error(`no expression field #${nth}`);
  commit(field, value);
}

function reactCall(fake: Editor["fake"], at = -1): { data: Anything[]; layout: Anything } {
  const call = fake.react.mock.calls.at(at) as unknown[] | undefined;
  if (call === undefined) throw new Error("Plotly.react was never called");
  return { data: call[1] as Anything[], layout: (call[2] ?? {}) as Anything };
}

const dataJson = (fake: Editor["fake"]): string => JSON.stringify(reactCall(fake).data);

function slider(root: HTMLElement): HTMLInputElement | undefined {
  return controls(root, /.*/).find((el): el is HTMLInputElement => el instanceof HTMLInputElement && el.type === "range");
}

const lay = (m: ChartModel): Anything => m.layout as unknown as Anything;
const axis = (m: ChartModel, key: "xaxis" | "yaxis"): Anything => lay(m)[key] as Anything;

describe("5.3c Axes tabs and the preview tools", () => {
  const withFn = (): ChartModel => fnModel([{ kind: "y", expr: ["x^2"] }]);

  function titleField(root: HTMLElement, nth = 0): HTMLInputElement {
    const found = controls(root, /title/i).filter((el): el is HTMLInputElement => el instanceof HTMLInputElement)[nth];
    if (found === undefined) throw new Error(`no title field #${nth}`);
    return found;
  }

  test("5.3c the X Axis tab sets the x axis title", async () => {
    const { root, last } = mount(withFn());
    tab(root, /^X Axis$/i).click();
    commit(titleField(root), "time");
    await settle(frames);
    expect(axis(last(), "xaxis").title).toBe("time");
    expect("title" in axis(last(), "yaxis")).toBe(false);
  });

  test("5.3c the Y Axis tab sets the y axis title", async () => {
    const { root, last } = mount(withFn());
    tab(root, /^Y Axis$/i).click();
    commit(titleField(root), "height");
    await settle(frames);
    expect(axis(last(), "yaxis").title).toBe("height");
    expect("title" in axis(last(), "xaxis")).toBe(false);
  });

  test("5.3c the Axes tab sets the x axis title", async () => {
    const { root, last } = mount(withFn());
    tab(root, /^Axes$/i).click();
    commit(titleField(root), "t (s)");
    await settle(frames);
    expect(axis(last(), "xaxis").title).toBe("t (s)");
  });

  test("5.3c the X Axis tab sets a manual range", async () => {
    const { root, last } = mount(withFn());
    tab(root, /^X Axis$/i).click();
    controls(root, /^manual$/i)[0]!.click();
    commit(controls(root, /\bmin/i).find((el): el is HTMLInputElement => el instanceof HTMLInputElement)!, "-2");
    commit(controls(root, /\bmax/i).find((el): el is HTMLInputElement => el instanceof HTMLInputElement)!, "5");
    await settle(frames);
    expect(axis(last(), "xaxis").range).toEqual([-2, 5]);
    expect("range" in axis(last(), "yaxis")).toBe(false);
  });

  test("5.3c the Y Axis tab sets a manual range", async () => {
    const { root, last } = mount(withFn());
    tab(root, /^Y Axis$/i).click();
    controls(root, /^manual$/i)[0]!.click();
    commit(controls(root, /\bmin/i).find((el): el is HTMLInputElement => el instanceof HTMLInputElement)!, "0");
    commit(controls(root, /\bmax/i).find((el): el is HTMLInputElement => el instanceof HTMLInputElement)!, "50");
    await settle(frames);
    expect(axis(last(), "yaxis").range).toEqual([0, 50]);
    expect("range" in axis(last(), "xaxis")).toBe(false);
  });

  test("5.3c a title and range change reach the preview's layout", async () => {
    const { root, fake } = mount(withFn());
    tab(root, /^X Axis$/i).click();
    commit(titleField(root), "time");
    controls(root, /^manual$/i)[0]!.click();
    commit(controls(root, /\bmin/i).find((el): el is HTMLInputElement => el instanceof HTMLInputElement)!, "1");
    commit(controls(root, /\bmax/i).find((el): el is HTMLInputElement => el instanceof HTMLInputElement)!, "100");
    await settle(frames);
    const xaxis = reactCall(fake).layout.xaxis as { title?: { text?: string }; range?: number[] };
    expect(xaxis.title?.text).toBe("time");
    expect(xaxis.range).toEqual([1, 100]);
  });

  const zoomIn = (root: HTMLElement): HTMLElement => controls(root, /zoom\s*in|zoom\s*\+|^\+$/i)[0]!;
  const zoomOut = (root: HTMLElement): HTMLElement => controls(root, /zoom\s*out|zoom\s*[−-]|^[−-]$/i)[0]!;
  const viewFull = (root: HTMLElement): HTMLElement => controls(root, /view full/i)[0]!;

  function updateOf(fake: Editor["fake"]): Anything {
    return (fake.relayout.mock.calls.at(-1) as unknown[])[1] as Anything;
  }

  function widthOf(update: Anything, key: "xaxis" | "yaxis"): number {
    const r = (update[`${key}.range`] as [number, number] | undefined) ?? [update[`${key}.range[0]`] as number, update[`${key}.range[1]`] as number];
    return r[1] - r[0];
  }

  test("5.3c Zoom + narrows the preview's ranges through relayout", async () => {
    const { root, fake } = mount(withFn());
    await settle(frames);
    zoomIn(root).click();
    await settle(frames);
    expect(fake.relayout).toHaveBeenCalledTimes(1);
    expect(widthOf(updateOf(fake), "xaxis")).toBeLessThan(20);
    expect(widthOf(updateOf(fake), "yaxis")).toBeLessThan(20);
  });

  test("5.3c Zoom − widens the preview's ranges through relayout", async () => {
    const { root, fake } = mount(withFn());
    await settle(frames);
    zoomOut(root).click();
    await settle(frames);
    expect(fake.relayout).toHaveBeenCalledTimes(1);
    expect(widthOf(updateOf(fake), "xaxis")).toBeGreaterThan(20);
  });

  test("5.3c View full asks both axes of the preview to autorange", async () => {
    const { root, fake } = mount(withFn());
    await settle(frames);
    viewFull(root).click();
    await settle(frames);
    expect(fake.relayout).toHaveBeenCalledTimes(1);
    expect(updateOf(fake)["xaxis.autorange"]).toBe(true);
    expect(updateOf(fake)["yaxis.autorange"]).toBe(true);
  });

  test("5.3c Zoom and View full do not change the model", async () => {
    const { root, calls } = mount(withFn());
    await settle(frames);
    const count = calls.length;
    zoomIn(root).click();
    zoomOut(root).click();
    viewFull(root).click();
    await settle(frames);
    expect(calls).toHaveLength(count);
  });

  test("5.3c Zoom and View full do not redraw the figure", async () => {
    const { root, fake } = mount(withFn());
    await settle(frames);
    fake.react.mockClear();
    zoomIn(root).click();
    viewFull(root).click();
    await settle(frames);
    expect(fake.react).not.toHaveBeenCalled();
  });
});

describe("A7 2D function plots end to end", () => {
  test.each([
    ["y = f(x)", ["x^2"]],
    ["x = f(y)", ["y^2"]],
    ["Inequality", ["x"]],
    ["Parametric curve", ["cos(t)", "sin(t)"]],
    ["Polar curve", ["1 + cos(θ)"]],
    ["Implicit curve", ["x^2 + y^2 - 4"]],
  ] as const)("A7 %s with %j plots a preview with data and no is-invalid field", async (label, exprs) => {
    const { root, fake } = mount(fnModel());
    addFn(root, label);
    exprs.forEach((text, i) => typeInto(root, i, text));
    await settle(frames);
    expect(root.querySelector(".is-invalid")).toBeNull();
    expect(reactCall(fake).data.length).toBeGreaterThan(0);
  });

  test("A7 a row using a variable plots and resamples when the variable changes", async () => {
    const { root, fake, last } = mount(fnModel([{ kind: "y", expr: ["k*x"] }], [{ name: "k", value: 1, min: 0, max: 10, step: 1 }]));
    await settle(frames);
    expect(reactCall(fake).data.length).toBeGreaterThan(0);
    const before = dataJson(fake);
    if (slider(root) === undefined) controls(root, /^Variables/i).find((el) => el.getAttribute("role") === "tab")?.click();
    const s = slider(root)!;
    s.value = "6";
    s.dispatchEvent(new Event("input", { bubbles: true }));
    await settle(frames);
    expect(dataJson(fake)).not.toBe(before);
    expect(last().vars[0]!.value).toBe(6);
  });

  test("A7 a bad expression shows a message and puts the caret at its position", async () => {
    const { root } = mount(fnModel());
    addFn(root, "y = f(x)");
    typeInto(root, 0, "2");
    await settle(frames);
    const before = (root.textContent ?? "").length;
    const text = "2 + * 3";
    const parsed = parseExpr(text);
    if (parsed.ok) throw new Error("test expression must not parse");
    typeInto(root, 0, text);
    await settle(frames);
    expect(root.querySelector(".is-invalid")).not.toBeNull();
    expect((root.textContent ?? "").length).toBeGreaterThan(before);
    const field = exprFields(root)[0]!;
    field.focus();
    field.dispatchEvent(new Event("focus"));
    expect(field.selectionStart).toBe(parsed.at);
  });

  test("A7 a bad expression in one row leaves a valid row of another kind plotted", async () => {
    const { root, fake } = mount(fnModel());
    addFn(root, "Polar curve");
    typeInto(root, 0, "1 + cos(θ)");
    await settle(frames);
    const alone = dataJson(fake);
    addFn(root, "y = f(x)");
    typeInto(root, 1, "2 + * 3");
    await settle(frames);
    expect(root.querySelector(".is-invalid")).not.toBeNull();
    expect(reactCall(fake).data.length).toBeGreaterThan(0);
    expect(dataJson(fake)).toBe(alone);
  });
});
