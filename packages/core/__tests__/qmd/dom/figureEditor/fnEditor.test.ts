/** @jest-environment jsdom */
/**
 * Tests mountFnEditor (plan charts, spec 5.3, D9, A7): the function plot dialog body. Tabs Expressions / Axes / X Axis / Y Axis, a "+ Add" menu of kinds,
 * rows with a relation dropdown, live-validated expression fields, "Variables +" with a slider, and a preview with Zoom + / Zoom − / View full.
 * The DOM is new, so controls are found by accessible name or visible text and by the one class the spec fixes (is-invalid), never by invented class names.
 * Model effects are read from onChange; preview redraws from the fake Plotly (its react mock); frames are queued by hand.
 */
import { parseExpr } from "../../../../src/drawing/expr";
import { emptyChart, type ChartFn, type ChartModel, type ChartVar } from "../../../../src/qmd/chart/model";
import { mountFnEditor } from "../../../../src/qmd/dom/figureEditor/fnEditor";
import { closeMenu } from "../../../../src/ui/dom/widgets/menu";
import { fakePlotly } from "../plotViewHarness";
import { controls, fakeFrames, setChoice, settle, type Frames } from "../chartEditor/chartEditorHarness";

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

function relationSelect(root: HTMLElement): HTMLSelectElement | undefined {
  return [...root.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.value === "<" || o.text.trim() === "<"));
}

function slider(root: HTMLElement): HTMLInputElement | undefined {
  return controls(root, /.*/).find((el): el is HTMLInputElement => el instanceof HTMLInputElement && el.type === "range");
}

/** Clicks Variables +; when that only opens a section (no slider yet), clicks the add-variable control found there. */
function addVariable(root: HTMLElement): void {
  const opener = controls(root, /^Variables\s*\+$/i)[0];
  if (opener === undefined) throw new Error("no Variables + control");
  opener.click();
  if (slider(root) !== undefined) return;
  const adder = controls(root, /add.*variable|variable.*add|^add$|^\+$|^\+\s*(var|variable)/i).find((el) => el !== opener && el.tagName === "BUTTON");
  if (adder === undefined) throw new Error("Variables + opened a section with no add control");
  adder.click();
}


describe("5.3a the + Add menu, rows and live validation", () => {
  test("5.3a the editor shows the Expressions, Axes, X Axis and Y Axis tabs", () => {
    const { root } = mount(fnModel());
    for (const name of [/^Expressions$/i, /^Axes$/i, /^X Axis$/i, /^Y Axis$/i]) expect(controls(root, name).length).toBeGreaterThan(0);
  });

  test("5.3a + Add › y = f(x) adds a row of kind y with the = relation", () => {
    const { root, calls, last } = mount(fnModel());
    addFn(root, "y = f(x)");
    expect(calls.length).toBeGreaterThan(0);
    expect(last().fns).toHaveLength(1);
    expect(last().fns[0]!.kind).toBe("y");
    expect([undefined, "="]).toContain(last().fns[0]!.rel);
  });

  test.each([
    ["x = f(y)", "x"],
    ["Parametric curve", "param"],
    ["Polar curve", "polar"],
    ["Implicit curve", "implicit"],
  ] as const)("5.3a + Add › %s adds a row of kind %s", (label, kind) => {
    const { root, last } = mount(fnModel());
    addFn(root, label);
    expect(last().fns).toHaveLength(1);
    expect(last().fns[0]!.kind).toBe(kind);
  });

  test("5.3a + Add › Inequality adds a row whose relation is not =", () => {
    const { root, last } = mount(fnModel());
    addFn(root, "Inequality");
    expect(last().fns).toHaveLength(1);
    const rel = last().fns[0]!.rel;
    expect(rel).toBeDefined();
    expect(rel).not.toBe("=");
  });

  test("5.3a a second + Add keeps the first row and appends the new one", () => {
    const { root, last } = mount(fnModel());
    addFn(root, "y = f(x)");
    addFn(root, "Polar curve");
    expect(last().fns.map((f) => f.kind)).toEqual(["y", "polar"]);
  });

  test("5.3a typing an expression writes it to the row", async () => {
    const { root, last } = mount(fnModel());
    addFn(root, "y = f(x)");
    typeInto(root, 0, "x^2");
    await settle(frames);
    expect(last().fns[0]!.expr).toEqual(["x^2"]);
  });

  test("5.3a typing an expression redraws the preview with a changed figure", async () => {
    const { root, fake } = mount(fnModel());
    addFn(root, "y = f(x)");
    await settle(frames);
    const before = fake.react.mock.calls.length > 0 ? dataJson(fake) : "[]";
    const count = fake.react.mock.calls.length;
    typeInto(root, 0, "x^2");
    await settle(frames);
    expect(fake.react.mock.calls.length).toBeGreaterThan(count);
    expect(reactCall(fake).data.length).toBeGreaterThan(0);
    expect(dataJson(fake)).not.toBe(before);
  });

  test("5.3a editing the expression again redraws again", async () => {
    const { root, fake } = mount(fnModel());
    addFn(root, "y = f(x)");
    typeInto(root, 0, "x^2");
    await settle(frames);
    const first = dataJson(fake);
    typeInto(root, 0, "2*x + 1");
    await settle(frames);
    expect(dataJson(fake)).not.toBe(first);
  });

  test("5.3a a valid expression leaves its field without is-invalid", async () => {
    const { root } = mount(fnModel());
    addFn(root, "y = f(x)");
    typeInto(root, 0, "sin(x)");
    await settle(frames);
    expect(root.querySelector(".is-invalid")).toBeNull();
  });

  test("5.3a an invalid expression marks its field is-invalid", async () => {
    const { root } = mount(fnModel());
    addFn(root, "y = f(x)");
    typeInto(root, 0, "2 + * 3");
    await settle(frames);
    expect(root.querySelector(".is-invalid")).not.toBeNull();
  });

  test("5.3a an invalid expression shows a message under the field", async () => {
    const { root } = mount(fnModel());
    addFn(root, "y = f(x)");
    typeInto(root, 0, "2");
    await settle(frames);
    const before = (root.textContent ?? "").length;
    typeInto(root, 0, "2 + * 3");
    await settle(frames);
    expect((root.textContent ?? "").length).toBeGreaterThan(before);
  });

  test("5.3a fixing an invalid expression clears is-invalid", async () => {
    const { root } = mount(fnModel());
    addFn(root, "y = f(x)");
    typeInto(root, 0, "2 + * 3");
    await settle(frames);
    typeInto(root, 0, "2 + 3");
    await settle(frames);
    expect(root.querySelector(".is-invalid")).toBeNull();
  });

  test("5.3a focusing an invalid field places the caret at the error offset", async () => {
    const { root } = mount(fnModel());
    addFn(root, "y = f(x)");
    const text = "2 + * 3";
    const parsed = parseExpr(text);
    if (parsed.ok) throw new Error("test expression must not parse");
    typeInto(root, 0, text);
    await settle(frames);
    const field = exprFields(root)[0]!;
    field.focus();
    field.dispatchEvent(new Event("focus"));
    expect(field.selectionStart).toBe(parsed.at);
  });

  test("5.3a an invalid row keeps the other rows plotted", async () => {
    const { root, fake } = mount(fnModel());
    addFn(root, "y = f(x)");
    typeInto(root, 0, "x^2");
    await settle(frames);
    const alone = dataJson(fake);
    expect(reactCall(fake).data.length).toBeGreaterThan(0);
    addFn(root, "y = f(x)");
    typeInto(root, 1, "2 + * 3");
    await settle(frames);
    expect(root.querySelector(".is-invalid")).not.toBeNull();
    expect(reactCall(fake).data.length).toBeGreaterThan(0);
    expect(dataJson(fake)).toBe(alone);
  });

  test("5.3a the relation dropdown appears for a y = f(x) row and not for a polar row", () => {
    const a = mount(fnModel());
    addFn(a.root, "y = f(x)");
    expect(relationSelect(a.root)).toBeDefined();
    const b = mount(fnModel());
    addFn(b.root, "Polar curve");
    expect(relationSelect(b.root)).toBeUndefined();
  });

  test("5.3a the relation dropdown offers =, <, >, ≤ and ≥", () => {
    const { root } = mount(fnModel());
    addFn(root, "y = f(x)");
    const texts = [...relationSelect(root)!.options].map((o) => o.text.trim());
    for (const want of ["=", "<", ">", "≤", "≥"]) expect(texts).toContain(want);
  });
});

describe("5.3b relations and variables", () => {
  test("5.3b choosing < in the relation dropdown sets the row's relation to <", async () => {
    const { root, last } = mount(fnModel());
    addFn(root, "y = f(x)");
    typeInto(root, 0, "x");
    const select = relationSelect(root)!;
    const option = [...select.options].find((o) => o.value === "<" || o.text.trim() === "<")!;
    select.value = option.value;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await settle(frames);
    expect(last().fns).toHaveLength(1);
    expect(last().fns[0]!.rel).toBe("<");
    expect(last().fns[0]!.expr).toEqual(["x"]);
  });

  test("5.3b choosing ≥ sets the relation to >=", async () => {
    const { root, last } = mount(fnModel());
    addFn(root, "y = f(x)");
    typeInto(root, 0, "x");
    const select = relationSelect(root)!;
    const option = [...select.options].find((o) => o.value === ">=" || o.text.trim() === "≥")!;
    select.value = option.value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await settle(frames);
    expect(last().fns[0]!.rel).toBe(">=");
  });

  test("5.3b choosing < redraws the preview as a region", async () => {
    const { root, fake } = mount(fnModel());
    addFn(root, "y = f(x)");
    typeInto(root, 0, "x");
    await settle(frames);
    const before = dataJson(fake);
    const select = relationSelect(root)!;
    const option = [...select.options].find((o) => o.value === "<" || o.text.trim() === "<")!;
    select.value = option.value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await settle(frames);
    expect(dataJson(fake)).not.toBe(before);
  });

  test("5.3b Variables + adds a variable with a slider", async () => {
    const { root, last } = mount(fnModel([{ kind: "y", expr: ["x"] }]));
    expect(slider(root)).toBeUndefined();
    addVariable(root);
    await settle(frames);
    expect(last().vars).toHaveLength(1);
    expect(slider(root)).toBeDefined();
  });

  test("5.3b the slider's last value is in the model passed to onChange", async () => {
    const { root, last } = mount(fnModel([{ kind: "y", expr: ["x"] }]));
    addVariable(root);
    await settle(frames);
    const s = slider(root)!;
    s.value = Number(s.value) === Number(s.max) ? s.min : s.max;
    s.dispatchEvent(new Event("input", { bubbles: true }));
    await settle(frames);
    expect(last().vars[0]!.value).toBe(Number(s.value));
  });

  const K: ChartVar = { name: "k", value: 1, min: 0, max: 10, step: 1 };
  const withVar = (): ChartModel => fnModel([{ kind: "y", expr: ["k*x"] }], [K]);

  function sliderOf(root: HTMLElement): HTMLInputElement {
    if (slider(root) === undefined) {
      const vars = controls(root, /^Variables/i).find((el) => el.getAttribute("role") === "tab");
      vars?.click();
    }
    const s = slider(root);
    if (s === undefined) throw new Error("no slider for the variable k");
    return s;
  }

  function slide(s: HTMLInputElement, value: number): void {
    s.value = String(value);
    s.dispatchEvent(new Event("input", { bubbles: true }));
  }

  test("5.3b moving the slider writes the value to vars[].value", async () => {
    const { root, last } = mount(withVar());
    slide(sliderOf(root), 5);
    await settle(frames);
    expect(last().vars).toHaveLength(1);
    expect(last().vars[0]).toMatchObject({ name: "k", value: 5 });
  });

  test("5.3b after several slider moves the model holds the last value", async () => {
    const { root, last } = mount(withVar());
    const s = sliderOf(root);
    slide(s, 2);
    slide(s, 6);
    slide(s, 9);
    await settle(frames);
    expect(last().vars[0]!.value).toBe(9);
  });

  test("5.3b moving the slider keeps the variable's min, max and step", async () => {
    const { root, last } = mount(withVar());
    slide(sliderOf(root), 4);
    await settle(frames);
    expect(last().vars[0]).toMatchObject({ min: 0, max: 10, step: 1 });
  });

  test("5.3b moving the slider resamples the preview", async () => {
    const { root, fake } = mount(withVar());
    const s = sliderOf(root);
    await settle(frames);
    const before = dataJson(fake);
    slide(s, 5);
    await settle(frames);
    expect(dataJson(fake)).not.toBe(before);
  });

  test("5.3b slider moves within one frame resample once", async () => {
    const { root, fake } = mount(withVar());
    const s = sliderOf(root);
    await settle(frames);
    fake.react.mockClear();
    slide(s, 2);
    slide(s, 4);
    slide(s, 7);
    await settle(frames);
    expect(fake.react).toHaveBeenCalledTimes(1);
  });

  test("5.3b typing a value writes it to vars[].value", async () => {
    const { root, last } = mount(withVar());
    sliderOf(root);
    const field = controls(root, /value/i).find((el): el is HTMLInputElement => el instanceof HTMLInputElement && el.type !== "range");
    if (field === undefined) throw new Error("no value field for the variable");
    commit(field, "3");
    await settle(frames);
    expect(last().vars[0]!.value).toBe(3);
  });
});

