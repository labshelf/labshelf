/** @jest-environment jsdom */
/**
 * Tests the 3D function dialog of mountFnEditor (plan charts, spec 6.2, D9, D13, A8): the 3D "+ Add" kinds, domain and steps fields on the rows,
 * the Z Axis tab, the Colourscale select, the preview's Reset view and the camera written from a relayout event.
 * Controls are found by visible label, as in fnEditor.test.ts; the fake Plotly has no `on`, so the plot div gets one by hand when it is drawn.
 */
import { emptyChart, type ChartFn, type ChartModel } from "../../../../src/qmd/chart/model";
import { mountFnEditor } from "../../../../src/qmd/dom/chartEditor/fnEditor";
import { closeMenu } from "../../../../src/ui/dom/widgets/menu";
import { fakePlotly } from "../plotViewHarness";
import { chooseOption, controls, fakeFrames, setChoice, settle, type Frames } from "./chartEditorHarness";

type Anything = Record<string, unknown>;
type Handler = (event: Record<string, unknown>) => void;

function model3d(fns: ChartFn[] = [], layout: Partial<ChartModel["layout"]> = {}): ChartModel {
  const base = emptyChart("fn3d", "a1b2c3d4");
  return { ...base, fns, layout: { ...base.layout, ...layout } };
}

function model2d(fns: ChartFn[] = []): ChartModel {
  return { ...emptyChart("fn2d", "a1b2c3d4"), fns };
}

let frames: Frames;
let roots: HTMLElement[] = [];
let destroyers: (() => void)[] = [];

interface Editor {
  root: HTMLElement;
  fake: ReturnType<typeof fakePlotly>;
  calls: ChartModel[];
  last(): ChartModel;
  /** Fires a plotly_relayout event on the plot div, as Plotly does after a drag. */
  relayout(event: Record<string, unknown>): void;
  subscribers(): number;
}

function mount(model: ChartModel, dims: 2 | 3 = 3): Editor {
  const root = document.createElement("div");
  document.body.append(root);
  roots.push(root);
  const fake = fakePlotly();
  const handlers: Handler[] = [];
  // Plotly adds `on` to the div it draws into; the fake does so when it is asked to draw.
  fake.react.mockImplementation((el: HTMLElement, data: readonly object[], layout?: object) => {
    const plot = el as unknown as Anything;
    plot.on = (name: string, handler: Handler): void => { if (name === "plotly_relayout") handlers.push(handler); };
    plot.removeListener = (name: string, handler: Handler): void => {
      const at = handlers.indexOf(handler);
      if (name === "plotly_relayout" && at >= 0) handlers.splice(at, 1);
    };
    plot._fullLayout = { xaxis: { range: [-10, 10] }, yaxis: { range: [-10, 10] } };
    plot.data = data;
    plot.layout = layout;
    return Promise.resolve();
  });
  const calls: ChartModel[] = [];
  const handle = mountFnEditor(root, model, (next) => { calls.push(next); }, async () => fake.api, dims);
  destroyers.push(() => handle.destroy());
  return {
    root, fake, calls, last: () => calls[calls.length - 1]!,
    relayout(event) { for (const h of [...handlers]) h(event); },
    subscribers: () => handlers.length,
  };
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

/** The labels of the items '+ Add' offers. */
function addMenuLabels(root: HTMLElement): string[] {
  addButton(root).click();
  const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"], [role="option"], [role="menuitemradio"]')].map((el) => (el.textContent ?? "").trim());
  closeMenu();
  return items;
}

function tab(root: HTMLElement, name: RegExp): HTMLElement {
  const all = controls(root, name);
  const found = all.find((el) => el.getAttribute("role") === "tab") ?? all[0];
  if (found === undefined) throw new Error(`no tab ${String(name)}`);
  return found;
}

const NOT_EXPR = /variable|title|\bvalue\b|\bmin\b|\bmax\b|\bstep|\bname\b/i;

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

function inputs(root: HTMLElement, name: RegExp): HTMLInputElement[] {
  return controls(root, name).filter((el): el is HTMLInputElement => el instanceof HTMLInputElement);
}

/** The min or max field of a variable's domain, found by its label ("x min", "min x"). */
function bound(root: HTMLElement, variable: string, which: "min" | "max"): HTMLInputElement {
  const found = inputs(root, new RegExp(`(\\b${variable}\\b.*\\b${which}\\b)|(\\b${which}\\b.*\\b${variable}\\b)`, "i"))[0];
  if (found === undefined) throw new Error(`no ${variable} ${which} field`);
  return found;
}

function stepFields(root: HTMLElement): HTMLInputElement[] {
  return inputs(root, /steps/i);
}

function reactCall(fake: Editor["fake"], at = -1): { data: Anything[]; layout: Anything } {
  const call = fake.react.mock.calls.at(at) as unknown[] | undefined;
  if (call === undefined) throw new Error("Plotly.react was never called");
  return { data: call[1] as Anything[], layout: (call[2] ?? {}) as Anything };
}

const figureJson = (fake: Editor["fake"]): string => JSON.stringify(reactCall(fake));
const dataJson = (fake: Editor["fake"]): string => JSON.stringify(reactCall(fake).data);

function relationSelect(root: HTMLElement): HTMLSelectElement | undefined {
  return [...root.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.value === "<" || o.text.trim() === "<"));
}

const lay = (m: ChartModel): Anything => m.layout as unknown as Anything;
const sceneCamera = (fake: Editor["fake"]): unknown => (reactCall(fake).layout.scene as Anything | undefined)?.camera;

const CAMERA_EVENT = { "scene.camera": { eye: { x: 1.23456, y: -0.98764, z: 0.77774 }, center: { x: 0.00004, y: 0.2, z: -0.1 }, up: { x: 0, y: 0, z: 1 } } };
const CAMERA_ROUNDED = { eye: { x: 1.2346, y: -0.9876, z: 0.7777 }, center: { x: 0, y: 0.2, z: -0.1 }, up: { x: 0, y: 0, z: 1 } };

describe("6.2a the 3D + Add menu and the row fields", () => {
  test("6.2a the 3D editor shows the Expressions, Axes, X Axis, Y Axis and Z Axis tabs", () => {
    const { root } = mount(model3d());
    for (const name of [/^Expressions$/i, /^Axes$/i, /^X Axis$/i, /^Y Axis$/i, /^Z Axis$/i]) expect(controls(root, name).length).toBeGreaterThan(0);
  });

  test("6.2a the 2D editor has no Z Axis tab", () => {
    const { root } = mount(model2d(), 2);
    expect(controls(root, /^Z Axis$/i)).toHaveLength(0);
  });

  test("6.2a + Add lists z = f(x,y), Parametric surface and 3D curve in 3D", () => {
    const { root } = mount(model3d());
    const labels = addMenuLabels(root);
    for (const want of ["z = f(x,y)", "Parametric surface", "3D curve"]) expect(labels).toContain(want);
  });

  test("6.2a + Add in 3D does not offer the 2D kinds", () => {
    const { root } = mount(model3d());
    const labels = addMenuLabels(root);
    for (const not of ["y = f(x)", "x = f(y)", "Inequality", "Polar curve", "Implicit curve"]) expect(labels).not.toContain(not);
  });

  test.each([
    ["z = f(x,y)", "surface"],
    ["Parametric surface", "param3d"],
    ["3D curve", "curve3d"],
  ] as const)("6.2a + Add › %s adds a row of kind %s", (label, kind) => {
    const { root, last } = mount(model3d());
    addFn(root, label);
    expect(last().fns).toHaveLength(1);
    expect(last().fns[0]!.kind).toBe(kind);
  });

  test.each([
    ["z = f(x,y)", 1],
    ["Parametric surface", 3],
    ["3D curve", 3],
  ] as const)("6.2a + Add › %s starts with %i default expression(s), none empty", (label, count) => {
    const { root, last } = mount(model3d());
    addFn(root, label);
    expect(last().fns[0]!.expr).toHaveLength(count);
    for (const e of last().fns[0]!.expr) expect(e.trim()).not.toBe("");
  });

  test("6.2a a new default z = f(x,y) row plots a surface in the preview", async () => {
    const { root, fake } = mount(model3d());
    addFn(root, "z = f(x,y)");
    await settle(frames);
    expect(reactCall(fake).data.length).toBeGreaterThan(0);
    expect(root.querySelector(".is-invalid")).toBeNull();
  });

  test("6.2a a second + Add keeps the first row and appends the new one", () => {
    const { root, last } = mount(model3d());
    addFn(root, "z = f(x,y)");
    addFn(root, "3D curve");
    expect(last().fns.map((f) => f.kind)).toEqual(["surface", "curve3d"]);
  });

  test("6.2a rows have no relation dropdown in 3D", () => {
    const { root } = mount(model3d());
    addFn(root, "z = f(x,y)");
    addFn(root, "Parametric surface");
    addFn(root, "3D curve");
    expect(relationSelect(root)).toBeUndefined();
  });

  test("6.2a a z = f(x,y) row has x and y domain fields and two steps fields", () => {
    const { root } = mount(model3d());
    addFn(root, "z = f(x,y)");
    for (const v of ["x", "y"]) {
      expect(bound(root, v, "min")).toBeInstanceOf(HTMLInputElement);
      expect(bound(root, v, "max")).toBeInstanceOf(HTMLInputElement);
    }
    expect(stepFields(root)).toHaveLength(2);
  });

  test("6.2a a Parametric surface row has u and v domain fields and two steps fields", () => {
    const { root } = mount(model3d());
    addFn(root, "Parametric surface");
    for (const v of ["u", "v"]) {
      expect(bound(root, v, "min")).toBeInstanceOf(HTMLInputElement);
      expect(bound(root, v, "max")).toBeInstanceOf(HTMLInputElement);
    }
    expect(stepFields(root)).toHaveLength(2);
  });

  test("6.2a a 3D curve row has a t domain and one steps field", () => {
    const { root } = mount(model3d());
    addFn(root, "3D curve");
    expect(bound(root, "t", "min")).toBeInstanceOf(HTMLInputElement);
    expect(bound(root, "t", "max")).toBeInstanceOf(HTMLInputElement);
    expect(stepFields(root)).toHaveLength(1);
  });

  test("6.2a the domain and steps fields show the row's stored values", () => {
    const fn: ChartFn = { kind: "surface", expr: ["x*y"], domain: [-3, 4], domain2: [-5, 6], steps: [11, 13] };
    const { root } = mount(model3d([fn]));
    expect(Number(bound(root, "x", "min").value)).toBe(-3);
    expect(Number(bound(root, "x", "max").value)).toBe(4);
    expect(Number(bound(root, "y", "min").value)).toBe(-5);
    expect(Number(bound(root, "y", "max").value)).toBe(6);
    expect(stepFields(root).map((f) => Number(f.value))).toEqual([11, 13]);
  });

  test("6.2a editing the x domain writes fn.domain", async () => {
    const { root, last } = mount(model3d());
    addFn(root, "z = f(x,y)");
    commit(bound(root, "x", "min"), "-2");
    commit(bound(root, "x", "max"), "3");
    await settle(frames);
    expect(last().fns[0]!.domain).toEqual([-2, 3]);
  });

  test("6.2a editing the y domain writes fn.domain2", async () => {
    const { root, last } = mount(model3d());
    addFn(root, "z = f(x,y)");
    commit(bound(root, "y", "min"), "-4");
    commit(bound(root, "y", "max"), "5");
    await settle(frames);
    expect(last().fns[0]!.domain2).toEqual([-4, 5]);
  });

  test("6.2a editing the u and v domains of a parametric surface writes domain and domain2", async () => {
    const { root, last } = mount(model3d());
    addFn(root, "Parametric surface");
    commit(bound(root, "u", "min"), "0");
    commit(bound(root, "u", "max"), "6");
    commit(bound(root, "v", "min"), "-1");
    commit(bound(root, "v", "max"), "1");
    await settle(frames);
    expect(last().fns[0]!.domain).toEqual([0, 6]);
    expect(last().fns[0]!.domain2).toEqual([-1, 1]);
  });

  test("6.2a editing the two steps fields of a surface writes fn.steps as a pair", async () => {
    const { root, last } = mount(model3d());
    addFn(root, "z = f(x,y)");
    const [first, second] = stepFields(root);
    commit(first!, "12");
    commit(second!, "9");
    await settle(frames);
    expect(last().fns[0]!.steps).toEqual([12, 9]);
  });

  test("6.2a editing the steps of a 3D curve writes a number", async () => {
    const { root, last } = mount(model3d());
    addFn(root, "3D curve");
    commit(stepFields(root)[0]!, "40");
    await settle(frames);
    expect(last().fns[0]!.steps).toBe(40);
  });

  test("6.2a editing the steps redraws the surface with a changed figure", async () => {
    const { root, fake } = mount(model3d());
    addFn(root, "z = f(x,y)");
    await settle(frames);
    const before = dataJson(fake);
    const count = fake.react.mock.calls.length;
    const [first, second] = stepFields(root);
    commit(first!, "7");
    commit(second!, "9");
    await settle(frames);
    expect(fake.react.mock.calls.length).toBeGreaterThan(count);
    expect(dataJson(fake)).not.toBe(before);
  });

  test("6.2a editing the domain redraws the surface with a changed figure", async () => {
    const { root, fake } = mount(model3d());
    addFn(root, "z = f(x,y)");
    await settle(frames);
    const before = dataJson(fake);
    commit(bound(root, "x", "min"), "-1");
    commit(bound(root, "x", "max"), "2");
    await settle(frames);
    expect(dataJson(fake)).not.toBe(before);
  });

  test("6.2a typing an expression writes it to the row and redraws", async () => {
    const { root, fake, last } = mount(model3d());
    addFn(root, "z = f(x,y)");
    await settle(frames);
    const before = dataJson(fake);
    typeInto(root, 0, "x*y");
    await settle(frames);
    expect(last().fns[0]!.expr).toEqual(["x*y"]);
    expect(dataJson(fake)).not.toBe(before);
  });

  test("6.2a an invalid 3D expression marks its field is-invalid", async () => {
    const { root } = mount(model3d());
    addFn(root, "z = f(x,y)");
    typeInto(root, 0, "x + * y");
    await settle(frames);
    expect(root.querySelector(".is-invalid")).not.toBeNull();
  });

  test("6.2a the 2D editor keeps its single steps field on a parametric curve", () => {
    const { root } = mount(model2d(), 2);
    setChoice(addButton(root), "Parametric curve");
    expect(stepFields(root)).toHaveLength(1);
  });
});

describe("6.2b the Z Axis tab and the colourscale", () => {
  const surface = (): ChartModel => model3d([{ kind: "surface", expr: ["sin(x)*cos(y)"] }]);

  function titleField(root: HTMLElement): HTMLInputElement {
    const found = inputs(root, /title/i)[0];
    if (found === undefined) throw new Error("no title field");
    return found;
  }

  function colourscale(root: HTMLElement): HTMLSelectElement {
    tab(root, /^Axes$/i).click();
    const found = controls(root, /colou?rscale/i).find((el): el is HTMLSelectElement => el instanceof HTMLSelectElement);
    if (found === undefined) throw new Error("no Colourscale select");
    return found;
  }

  test("6.2b the Z Axis tab sets the z axis title", async () => {
    const { root, last } = mount(surface());
    tab(root, /^Z Axis$/i).click();
    commit(titleField(root), "height");
    await settle(frames);
    expect((lay(last()).zaxis as Anything).title).toBe("height");
    expect("title" in (lay(last()).xaxis as Anything)).toBe(false);
    expect("title" in (lay(last()).yaxis as Anything)).toBe(false);
  });

  test("6.2b the X Axis and Y Axis tabs still set their own titles in 3D", async () => {
    const { root, last } = mount(surface());
    tab(root, /^X Axis$/i).click();
    commit(titleField(root), "xx");
    tab(root, /^Y Axis$/i).click();
    commit(titleField(root), "yy");
    await settle(frames);
    expect((lay(last()).xaxis as Anything).title).toBe("xx");
    expect((lay(last()).yaxis as Anything).title).toBe("yy");
    expect(lay(last()).zaxis === undefined || !("title" in (lay(last()).zaxis as Anything))).toBe(true);
  });

  test("6.2b the Z Axis tab sets a manual z range", async () => {
    const { root, last } = mount(surface());
    tab(root, /^Z Axis$/i).click();
    controls(root, /^manual$/i)[0]!.click();
    commit(inputs(root, /\bmin/i)[0]!, "-2");
    commit(inputs(root, /\bmax/i)[0]!, "5");
    await settle(frames);
    expect((lay(last()).zaxis as Anything).range).toEqual([-2, 5]);
    expect("range" in (lay(last()).xaxis as Anything)).toBe(false);
  });

  test("6.2b a z axis title changes the figure", async () => {
    const { root, fake } = mount(surface());
    await settle(frames);
    const before = figureJson(fake);
    tab(root, /^Z Axis$/i).click();
    commit(titleField(root), "height");
    await settle(frames);
    expect(figureJson(fake)).not.toBe(before);
    expect(figureJson(fake)).toContain("height");
  });

  test("6.2b the Axes tab has a Colourscale select offering Viridis, Cividis, Blues, RdBu, Portland and Hot", () => {
    const { root } = mount(surface());
    const labels = [...colourscale(root).options].map((o) => o.text.trim());
    for (const want of ["Viridis", "Cividis", "Blues", "RdBu", "Portland", "Hot"]) expect(labels).toContain(want);
  });

  test.each(["Viridis", "Cividis", "Blues", "RdBu", "Portland", "Hot"])("6.2b choosing %s writes layout.colorscale", async (name) => {
    const { root, last } = mount(surface());
    chooseOption(colourscale(root), name);
    await settle(frames);
    expect(lay(last()).colorscale).toBe(name);
  });

  test("6.2b choosing a colourscale changes the figure", async () => {
    const { root, fake } = mount(surface());
    await settle(frames);
    const before = figureJson(fake);
    chooseOption(colourscale(root), "Cividis");
    await settle(frames);
    expect(figureJson(fake)).not.toBe(before);
  });

  test("6.2b the Colourscale select shows the stored colourscale", () => {
    const { root } = mount(model3d([{ kind: "surface", expr: ["x*y"] }], { colorscale: "Portland" }));
    const select = colourscale(root);
    expect(select.options[select.selectedIndex]!.text.trim()).toBe("Portland");
  });
});

describe("6.2c the preview camera and Reset view", () => {
  const curve = (layout: Partial<ChartModel["layout"]> = {}): ChartModel => model3d([{ kind: "curve3d", expr: ["cos(t)", "sin(t)", "t"] }], layout);
  const resetView = (root: HTMLElement): HTMLElement | undefined => controls(root, /reset view/i)[0];

  test("6.2c a relayout event with a scene.camera puts the rounded camera in the model", async () => {
    const e = mount(curve());
    await settle(frames);
    e.relayout(CAMERA_EVENT);
    await settle(frames);
    expect(e.calls.length).toBeGreaterThan(0);
    expect(lay(e.last()).camera).toEqual(CAMERA_ROUNDED);
  });

  test("6.2c a relayout event without a scene.camera leaves the model alone", async () => {
    const e = mount(curve());
    await settle(frames);
    const count = e.calls.length;
    e.relayout({ "scene.aspectratio": { x: 1, y: 1, z: 1 } });
    await settle(frames);
    expect(e.calls).toHaveLength(count);
  });

  test("6.2c a camera event does not redraw the preview", async () => {
    const e = mount(curve());
    await settle(frames);
    e.fake.react.mockClear();
    e.relayout(CAMERA_EVENT);
    await settle(frames);
    expect(e.fake.react).not.toHaveBeenCalled();
  });

  test("6.2c a later edit keeps the camera in the model", async () => {
    const e = mount(model3d([{ kind: "surface", expr: ["x*y"] }]));
    await settle(frames);
    e.relayout(CAMERA_EVENT);
    typeInto(e.root, 0, "x+y");
    await settle(frames);
    expect(e.last().fns[0]!.expr).toEqual(["x+y"]);
    expect(lay(e.last()).camera).toEqual(CAMERA_ROUNDED);
  });

  test("6.2c reopening a model with a camera gives a figure with the same scene.camera", async () => {
    const first = mount(curve());
    await settle(frames);
    first.relayout(CAMERA_EVENT);
    await settle(frames);
    const stored = first.last();
    const second = mount(stored);
    await settle(frames);
    expect(sceneCamera(second.fake)).toEqual(CAMERA_ROUNDED);
  });

  test("6.2c a model without a camera gives a figure with no scene.camera", async () => {
    const { fake } = mount(curve());
    await settle(frames);
    expect(sceneCamera(fake)).toBeUndefined();
  });

  test("6.2c the 3D toolbar shows Reset view and not Zoom + / − or View full", async () => {
    const { root } = mount(curve());
    await settle(frames);
    expect(resetView(root)).toBeDefined();
    expect(controls(root, /zoom/i)).toHaveLength(0);
    expect(controls(root, /view full/i)).toHaveLength(0);
  });

  test("6.2c the 2D toolbar keeps Zoom and View full and has no Reset view", async () => {
    const { root } = mount(model2d([{ kind: "y", expr: ["x"] }]), 2);
    await settle(frames);
    expect(controls(root, /view full/i).length).toBeGreaterThan(0);
    expect(resetView(root)).toBeUndefined();
  });

  test("6.2c Reset view removes layout.camera from the model", async () => {
    const e = mount(curve({ camera: CAMERA_ROUNDED }));
    await settle(frames);
    resetView(e.root)!.click();
    await settle(frames);
    expect(e.calls.length).toBeGreaterThan(0);
    expect("camera" in lay(e.last())).toBe(false);
  });

  test("6.2c Reset view redraws the figure without a scene.camera", async () => {
    const e = mount(curve({ camera: CAMERA_ROUNDED }));
    await settle(frames);
    expect(sceneCamera(e.fake)).toEqual(CAMERA_ROUNDED);
    const count = e.fake.react.mock.calls.length;
    resetView(e.root)!.click();
    await settle(frames);
    expect(e.fake.react.mock.calls.length).toBeGreaterThan(count);
    expect(sceneCamera(e.fake)).toBeUndefined();
  });

  test("6.2c Reset view keeps the rest of the model", async () => {
    const e = mount(curve({ camera: CAMERA_ROUNDED, colorscale: "Hot" }));
    await settle(frames);
    resetView(e.root)!.click();
    await settle(frames);
    expect(e.last().fns).toEqual([{ kind: "curve3d", expr: ["cos(t)", "sin(t)", "t"] }]);
    expect(lay(e.last()).colorscale).toBe("Hot");
  });

  test("6.2c a camera written after Reset view is stored again", async () => {
    const e = mount(curve({ camera: CAMERA_ROUNDED }));
    await settle(frames);
    resetView(e.root)!.click();
    await settle(frames);
    e.relayout(CAMERA_EVENT);
    await settle(frames);
    expect(lay(e.last()).camera).toEqual(CAMERA_ROUNDED);
  });

  test("6.2c destroying the editor unsubscribes from the plot's relayout events", async () => {
    const e = mount(curve());
    await settle(frames);
    const onChangeCount = e.calls.length;
    for (const d of destroyers) d();
    destroyers = [];
    e.relayout(CAMERA_EVENT);
    await settle(frames);
    expect(e.calls).toHaveLength(onChangeCount);
  });
});

describe("A8 3D function plots end to end", () => {
  test.each([
    ["z = f(x,y)", ["sin(x)*cos(y)"]],
    ["Parametric surface", ["cos(u)*sin(v)", "sin(u)*sin(v)", "cos(v)"]],
    ["3D curve", ["cos(t)", "sin(t)", "t"]],
  ] as const)("A8 %s with %j plots a preview with data and no is-invalid field", async (label, exprs) => {
    const { root, fake } = mount(model3d());
    addFn(root, label);
    exprs.forEach((text, i) => typeInto(root, i, text));
    await settle(frames);
    expect(root.querySelector(".is-invalid")).toBeNull();
    expect(reactCall(fake).data.length).toBeGreaterThan(0);
  });

  test("A8 a surface with domains, steps, a colourscale and a camera round-trips through the model", async () => {
    const first = mount(model3d());
    addFn(first.root, "z = f(x,y)");
    typeInto(first.root, 0, "x*y");
    commit(bound(first.root, "x", "min"), "-2");
    commit(bound(first.root, "x", "max"), "2");
    const [a, b] = stepFields(first.root);
    commit(a!, "8");
    commit(b!, "10");
    tab(first.root, /^Axes$/i).click();
    const select = controls(first.root, /colou?rscale/i).find((el): el is HTMLSelectElement => el instanceof HTMLSelectElement)!;
    chooseOption(select, "Blues");
    await settle(frames);
    first.relayout(CAMERA_EVENT);
    await settle(frames);
    const stored = first.last();
    expect(stored.fns[0]).toMatchObject({ kind: "surface", expr: ["x*y"], domain: [-2, 2], steps: [8, 10] });
    expect(lay(stored).colorscale).toBe("Blues");
    expect(lay(stored).camera).toEqual(CAMERA_ROUNDED);

    const second = mount(stored);
    await settle(frames);
    expect(Number(bound(second.root, "x", "min").value)).toBe(-2);
    expect(stepFields(second.root).map((f) => Number(f.value))).toEqual([8, 10]);
    expect(reactCall(second.fake).data.length).toBeGreaterThan(0);
    expect(sceneCamera(second.fake)).toEqual(CAMERA_ROUNDED);
  });
});
