/** @jest-environment jsdom */
/**
 * Tests cameraOfRelayout and watchCamera (plan charts, spec 6.2, D13): reading the scene camera out of a plotly_relayout event, rounded to 4 decimals,
 * and subscribing to a plot div's `on('plotly_relayout', …)` when the div has `on`.
 */
import { emptyChart, type ChartFn, type ChartModel } from "../../../../src/qmd/chart/model";
import { mountFnEditor } from "../../../../src/qmd/dom/figureEditor/fnEditor";
import { cameraOfRelayout, watchCamera } from "../../../../src/qmd/dom/figureEditor/preview";
import { closeMenu } from "../../../../src/ui/dom/widgets/menu";
import { fakePlotly } from "../plotViewHarness";
import { chooseOption, controls, fakeFrames, setChoice, settle, type Frames } from "./chartEditorHarness";

type Anything = Record<string, unknown>;
type Handler = (event: Record<string, unknown>) => void;
type Plot = HTMLElement & { on?: unknown; removeListener?: unknown };

const RAW = { eye: { x: 1.23456, y: -0.98764, z: 0.00004 }, center: { x: 0.11114, y: 0.2, z: -0.33336 }, up: { x: 0, y: 0, z: 1.00006 } };
const ROUNDED = { eye: { x: 1.2346, y: -0.9876, z: 0 }, center: { x: 0.1111, y: 0.2, z: -0.3334 }, up: { x: 0, y: 0, z: 1.0001 } };

describe("6.2c cameraOfRelayout", () => {
  test("6.2c returns the scene.camera of an event with every number rounded to 4 decimals", () => {
    expect(cameraOfRelayout({ "scene.camera": RAW })).toEqual(ROUNDED);
  });

  test("6.2c keeps numbers that already have at most 4 decimals", () => {
    const camera = { eye: { x: 1.5, y: -2, z: 0.25 }, center: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 } };
    expect(cameraOfRelayout({ "scene.camera": camera })).toEqual(camera);
  });

  test("6.2c accepts a camera with only an eye", () => {
    expect(cameraOfRelayout({ "scene.camera": { eye: { x: 1.23456, y: 2, z: 3 } } })).toEqual({ eye: { x: 1.2346, y: 2, z: 3 } });
  });

  test("6.2c does not change the event it reads", () => {
    const camera = JSON.parse(JSON.stringify(RAW)) as typeof RAW;
    cameraOfRelayout({ "scene.camera": camera });
    expect(camera).toEqual(RAW);
  });

  test("6.2c returns null for an event without scene.camera", () => {
    expect(cameraOfRelayout({})).toBeNull();
    expect(cameraOfRelayout({ "xaxis.range": [0, 1] })).toBeNull();
  });

  test("6.2c returns null when scene.camera is not a camera", () => {
    expect(cameraOfRelayout({ "scene.camera": undefined })).toBeNull();
    expect(cameraOfRelayout({ "scene.camera": null })).toBeNull();
    expect(cameraOfRelayout({ "scene.camera": "front" })).toBeNull();
    expect(cameraOfRelayout({ "scene.camera": {} })).toBeNull();
  });

  test("6.2c returns null when the eye is missing or has a non-numeric component", () => {
    expect(cameraOfRelayout({ "scene.camera": { center: RAW.center, up: RAW.up } })).toBeNull();
    expect(cameraOfRelayout({ "scene.camera": { eye: { x: 1, y: "2", z: 3 } } })).toBeNull();
    expect(cameraOfRelayout({ "scene.camera": { eye: { x: 1, y: 2 } } })).toBeNull();
    expect(cameraOfRelayout({ "scene.camera": { eye: { x: 1, y: Number.NaN, z: 3 } } })).toBeNull();
  });
});

describe("6.2c watchCamera", () => {
  function plotWithOn(): { plot: Plot; on: jest.Mock; removeListener: jest.Mock; handler(): Handler } {
    const plot = document.createElement("div") as Plot;
    const on = jest.fn();
    const removeListener = jest.fn();
    plot.on = on;
    plot.removeListener = removeListener;
    return { plot, on, removeListener, handler: () => on.mock.calls.find((c) => c[0] === "plotly_relayout")![1] as Handler };
  }

  test("6.2c subscribes to plotly_relayout on the plot div", () => {
    const { plot, on } = plotWithOn();
    watchCamera(plot, () => undefined);
    expect(on).toHaveBeenCalledTimes(1);
    expect(on.mock.calls[0]![0]).toBe("plotly_relayout");
    expect(typeof on.mock.calls[0]![1]).toBe("function");
  });

  test("6.2c calls onCamera with the rounded camera of an event that has one", () => {
    const { plot, handler } = plotWithOn();
    const seen: unknown[] = [];
    watchCamera(plot, (camera) => seen.push(camera));
    handler()({ "scene.camera": RAW });
    expect(seen).toEqual([ROUNDED]);
  });

  test("6.2c calls onCamera once for each accepted event", () => {
    const { plot, handler } = plotWithOn();
    const onCamera = jest.fn();
    watchCamera(plot, onCamera);
    handler()({ "scene.camera": RAW });
    handler()({ "scene.camera": { eye: { x: 2, y: 2, z: 2 } } });
    expect(onCamera).toHaveBeenCalledTimes(2);
  });

  test("6.2c ignores events without a valid camera", () => {
    const { plot, handler } = plotWithOn();
    const onCamera = jest.fn();
    watchCamera(plot, onCamera);
    handler()({ "xaxis.range": [0, 1] });
    handler()({ "scene.camera": { eye: { x: "a" } } });
    handler()({});
    expect(onCamera).not.toHaveBeenCalled();
  });

  test("6.2c the unsubscribe removes the same listener that was added", () => {
    const { plot, on, removeListener } = plotWithOn();
    const stop = watchCamera(plot, () => undefined);
    expect(removeListener).not.toHaveBeenCalled();
    stop();
    expect(removeListener).toHaveBeenCalledTimes(1);
    expect(removeListener.mock.calls[0]![0]).toBe("plotly_relayout");
    expect(removeListener.mock.calls[0]![1]).toBe(on.mock.calls[0]![1]);
  });

  test("6.2c a plot div without on subscribes nothing and still returns an unsubscribe", () => {
    const plot = document.createElement("div");
    const stop = watchCamera(plot, () => undefined);
    expect(typeof stop).toBe("function");
    expect(() => stop()).not.toThrow();
  });

  test("6.2c the unsubscribe is safe when the div has on but no removeListener", () => {
    const plot = document.createElement("div") as Plot;
    plot.on = jest.fn();
    const stop = watchCamera(plot, () => undefined);
    expect(() => stop()).not.toThrow();
  });
});

// The preview camera and Reset view of the 3D function dialog (spec 6.2, D9, D13, A8): the fake Plotly has no `on`, so the plot div gets one by hand when it is drawn.
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

const lay = (m: ChartModel): Anything => m.layout as unknown as Anything;
const sceneCamera = (fake: Editor["fake"]): unknown => (reactCall(fake).layout.scene as Anything | undefined)?.camera;

const CAMERA_EVENT = { "scene.camera": { eye: { x: 1.23456, y: -0.98764, z: 0.77774 }, center: { x: 0.00004, y: 0.2, z: -0.1 }, up: { x: 0, y: 0, z: 1 } } };
const CAMERA_ROUNDED = { eye: { x: 1.2346, y: -0.9876, z: 0.7777 }, center: { x: 0, y: 0.2, z: -0.1 }, up: { x: 0, y: 0, z: 1 } };

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
