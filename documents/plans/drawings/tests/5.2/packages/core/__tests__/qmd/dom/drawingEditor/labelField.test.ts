/** @jest-environment jsdom */
/**
 * Tests the labels and expressions of openDrawingEditor in jsdom: the in-place TeX field (Enter, Tab, Esc), labels typeset
 * through the MathJax stub, the function expression field with its live curve, and broken labels and expressions that are boxed,
 * named and block the commit. Only the public seam is used; MathJax is stubbed at its lazy module (reached through
 * loadCoreMath), and parseMathSvg is the function exported from mathView.
 */
import { openDrawingEditor } from "../../../../src/qmd/dom/drawingEditor/openDrawingEditor";
import * as mathView from "../../../../src/qmd/dom/mathView";

const mockRender = jest.fn((tex: string, _display: boolean): string => {
  if (tex.includes("\\bad")) throw new Error("Missing close brace");
  return '<svg data-stub="label" style="color: red"><g style="fill: blue"><path d="M0 0"></path></g></svg>';
});
jest.mock("../../../../src/latex/hover/index", () => ({ renderMathSvg: (tex: string, display: boolean) => mockRender(tex, display) }));

type Model = Parameters<typeof openDrawingEditor>[1];
const EMPTY: Model = { v: 1, points: [], items: [] };

// jsdom has no layout and no SVG geometry API: client coordinates are taken as the canvas's own user coordinates.
beforeAll(() => {
  const identity = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0, inverse() { return this; }, multiply() { return this; } };
  const proto = SVGElement.prototype as unknown as Record<string, unknown>;
  const el = Element.prototype as unknown as Record<string, unknown>;
  proto.getScreenCTM ??= () => identity;
  proto.getCTM ??= () => identity;
  (SVGSVGElement.prototype as unknown as Record<string, unknown>).createSVGPoint ??= () => ({
    x: 0,
    y: 0,
    matrixTransform(m: typeof identity) { return { x: m.a * this.x + m.c * this.y + m.e, y: m.b * this.x + m.d * this.y + m.f }; },
  });
  el.setPointerCapture ??= () => undefined;
  el.releasePointerCapture ??= () => undefined;
  el.hasPointerCapture ??= () => false;
});

let host: HTMLElement;
let handle: { destroy(): void } | undefined;
afterEach(() => {
  handle?.destroy();
  handle = undefined;
  document.body.innerHTML = "";
});

const settle = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("condition not met in time");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function open(model: Model = EMPTY) {
  host = document.createElement("div");
  document.body.append(host);
  const done = jest.fn<void, [Model | null]>();
  handle = openDrawingEditor(host, model, done);
  await settle();
  return done;
}

// Tool buttons are found by accessible name (aria-label, else text); the shortcut lives in the title, so title is the last resort.
const nameOf = (el: Element) => el.getAttribute("aria-label") || (el.textContent ?? "").trim() || el.getAttribute("title") || "";
function button(name: RegExp): HTMLElement {
  const found = Array.from(host.querySelectorAll<HTMLElement>("button, [role='button']")).filter((b) => name.test(nameOf(b)));
  if (found.length !== 1) throw new Error(`expected one button named ${name}, found ${found.length}`);
  return found[0]!;
}
const canvas = (): SVGSVGElement => {
  const svg = Array.from(host.querySelectorAll<SVGSVGElement>("svg")).find((s) => !s.closest("button, [role='toolbar']"));
  if (!svg) throw new Error("no canvas svg in the editor");
  return svg;
};
const FIELD = 'input:not([type="color"]):not([type="range"]):not([type="checkbox"]):not([type="button"]), textarea';
const field = () => host.querySelector<HTMLInputElement | HTMLTextAreaElement>(FIELD);
function theField(): HTMLInputElement | HTMLTextAreaElement {
  const f = field();
  if (!f) throw new Error("no text field is open in the editor");
  return f;
}
const typeInto = (f: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  f.value = value;
  f.dispatchEvent(new Event("input", { bubbles: true }));
};
const key = (target: Element, k: string, init: KeyboardEventInit = {}) => target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init }));
function pointer(type: string, target: Element, x: number, y: number) {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === "pointerup" ? 0 : 1 }));
}
function drag(target: Element, from: [number, number], to: [number, number]) {
  pointer("pointerdown", target, ...from);
  pointer("pointermove", target, (from[0] + to[0]) / 2, (from[1] + to[1]) / 2);
  pointer("pointermove", target, ...to);
  pointer("pointerup", target, ...to);
}
const dblclickAt = (x: number, y: number) => canvas().dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, clientX: x, clientY: y }));
const lastModel = (done: jest.Mock<void, [Model | null]>) => done.mock.calls[0]![0] as Model;
const clickDone = () => button(/^done\b/i).click();

/** Double-clicks empty canvas, types `tex` into the label field that opens and confirms it with Enter. */
async function labelPointAt(x: number, y: number, tex: string) {
  dblclickAt(x, y);
  await settle();
  typeInto(theField(), tex);
  key(theField(), "Enter");
  await settle();
}
/** Drags a Function box and returns the expression field that opens. */
async function startFunction() {
  button(/^function\b/i).click();
  drag(canvas(), [60, 60], [260, 200]);
  await settle();
  return theField();
}
const curveSignature = () =>
  Array.from(canvas().querySelectorAll("path, polyline")).map((e) => e.getAttribute("d") ?? e.getAttribute("points") ?? "").join("|");
const boxed = (source: string) => Array.from(host.querySelectorAll('[class*="error"]')).filter((e) => (e.textContent ?? "").includes(source));
const named = (source: string) => Array.from(host.querySelectorAll('[role="alert"], [role="status"], [aria-live]')).filter((e) => (e.textContent ?? "").includes(source));

describe("parseMathSvg", () => {
  it("A5 is exported and strips every style attribute from a MathJax svg", () => {
    // Looked up by name so that, before the export exists, this fails at run time instead of the whole file failing to compile.
    const parseMathSvg = (mathView as unknown as { parseMathSvg?: (markup: string) => Element }).parseMathSvg;
    if (typeof parseMathSvg !== "function") throw new Error("not implemented: mathView does not export parseMathSvg");
    const svg = parseMathSvg('<svg style="color: red"><g style="fill: blue"><path style="stroke: green" d="M0 0"></path></g></svg>');
    expect(svg.tagName.toLowerCase()).toBe("svg");
    expect(svg.outerHTML).not.toMatch(/fill:\s*blue|stroke:\s*green|color:\s*red/);
    expect(svg.querySelectorAll("[style]")).toHaveLength(0);
  });
});

describe("label field", () => {
  it("A5 double-click on empty canvas opens a label field at once", async () => {
    await open();
    dblclickAt(80, 80);
    await settle();
    expect(field()).not.toBeNull();
  });

  it("A5 the label field is focused so typing goes straight into it", async () => {
    await open();
    dblclickAt(80, 80);
    await settle();
    expect(document.activeElement).toBe(field());
  });

  it("A5 Enter confirms the label, closes the field and keeps the editor open", async () => {
    const done = await open();
    await labelPointAt(80, 80, "A");
    expect(field()).toBeNull();
    expect(done).not.toHaveBeenCalled();
  });

  it("A5 the confirmed label is stored on the new point", async () => {
    const done = await open();
    await labelPointAt(80, 80, "\\alpha");
    clickDone();
    expect(lastModel(done).points).toHaveLength(1);
    expect(lastModel(done).points[0]!.label).toBe("\\alpha");
  });

  it("A5 two double-clicks with labels make two labelled points in order", async () => {
    const done = await open();
    await labelPointAt(80, 80, "A");
    await labelPointAt(240, 80, "B");
    clickDone();
    expect(lastModel(done).points.map((p) => p.label)).toEqual(["A", "B"]);
  });

  it("A5 Esc in the label field leaves the point unlabelled", async () => {
    const done = await open();
    dblclickAt(80, 80);
    await settle();
    typeInto(theField(), "A");
    key(theField(), "Escape");
    await settle();
    expect(field()).toBeNull();
    clickDone();
    expect(lastModel(done).points).toHaveLength(1);
    expect(lastModel(done).points[0]!.label ?? "").toBe("");
  });

  it("A5 Esc in the label field closes the field only and does not commit the drawing", async () => {
    const done = await open();
    dblclickAt(80, 80);
    await settle();
    key(theField(), "Escape");
    await settle();
    expect(done).not.toHaveBeenCalled();
  });

  it("A5 Tab confirms the label typed in the field", async () => {
    const done = await open();
    dblclickAt(80, 80);
    await settle();
    typeInto(theField(), "A");
    key(theField(), "Tab");
    await settle();
    const next = field();
    if (next) key(next, "Escape");
    clickDone();
    expect(lastModel(done).points[0]!.label).toBe("A");
  });

  it("A5 Tab does not commit the drawing", async () => {
    const done = await open();
    dblclickAt(80, 80);
    await settle();
    typeInto(theField(), "A");
    key(theField(), "Tab");
    await settle();
    expect(done).not.toHaveBeenCalled();
  });

  it("A5 a confirmed label is typeset through MathJax", async () => {
    await open();
    await labelPointAt(80, 80, "x^2");
    await until(() => host.querySelector("svg[data-stub]") !== null);
    expect(mockRender.mock.calls.some(([tex]) => tex === "x^2")).toBe(true);
  });

  it("A5 the typeset label carries no style attribute", async () => {
    await open();
    await labelPointAt(80, 80, "x^2");
    await until(() => host.querySelector("svg[data-stub]") !== null);
    expect(host.querySelectorAll("[style]")).toHaveLength(0);
    expect(host.innerHTML).not.toMatch(/color:\s*red|fill:\s*blue/);
  });

  it("A5 a label can be undone as one gesture", async () => {
    const done = await open();
    await labelPointAt(80, 80, "A");
    button(/^undo\b/i).click();
    clickDone();
    expect(lastModel(done).points.every((p) => !p.label)).toBe(true);
  });

  it("A5 the field opens empty for a new point", async () => {
    await open();
    dblclickAt(80, 80);
    await settle();
    expect(theField().value).toBe("");
  });
});

describe("broken labels", () => {
  async function breakLabel() {
    const done = await open();
    await labelPointAt(80, 80, "\\bad{");
    await until(() => boxed("\\bad{").length > 0);
    return done;
  }

  it("A6 a label that does not parse shows its source in a box with an error class", async () => {
    await breakLabel();
    expect(boxed("\\bad{").length).toBeGreaterThan(0);
  });

  it("A6 the editor names the broken label", async () => {
    await breakLabel();
    expect(named("\\bad{").length).toBeGreaterThan(0);
  });

  it("A6 Done does not commit while a label is broken", async () => {
    const done = await breakLabel();
    clickDone();
    await settle();
    expect(done).not.toHaveBeenCalled();
  });

  it("A6 Esc does not commit while a label is broken", async () => {
    const done = await breakLabel();
    key(canvas(), "Escape");
    await settle();
    expect(done).not.toHaveBeenCalled();
  });

  it("A6 undoing the broken label unblocks the commit", async () => {
    const done = await breakLabel();
    button(/^undo\b/i).click();
    await settle();
    clickDone();
    expect(done).toHaveBeenCalledTimes(1);
    expect(lastModel(done).points.every((p) => !(p.label ?? "").includes("\\bad"))).toBe(true);
  });

  it("A6 a valid label next to a broken one still leaves the commit blocked", async () => {
    const done = await breakLabel();
    await labelPointAt(240, 80, "B");
    clickDone();
    await settle();
    expect(done).not.toHaveBeenCalled();
  });
});

describe("function expression field", () => {
  it("A5 the Function tool opens the expression field after the box is dragged", async () => {
    await open();
    const f = await startFunction();
    expect(f).toBeTruthy();
    expect(document.activeElement).toBe(f);
  });

  it("A5 the Function tool makes axes and a function in the committed model", async () => {
    const done = await open();
    const f = await startFunction();
    typeInto(f, "x^2");
    key(f, "Enter");
    await settle();
    clickDone();
    const items = lastModel(done).items;
    expect(items.filter((i) => i.k === "axes")).toHaveLength(1);
    expect(items.filter((i) => i.k === "fn")).toHaveLength(1);
  });

  it("A5 the committed function keeps the typed expression", async () => {
    const done = await open();
    const f = await startFunction();
    typeInto(f, "2x^2 - 1");
    key(f, "Enter");
    await settle();
    clickDone();
    const fn = lastModel(done).items.find((i) => i.k === "fn") as unknown as { expr: string };
    expect(fn.expr.replace(/\s+/g, "")).toBe("2x^2-1");
  });

  it("A5 the curve appears while typing, before Enter", async () => {
    await open();
    const f = await startFunction();
    const before = curveSignature();
    typeInto(f, "x^2");
    await settle();
    expect(curveSignature()).not.toBe(before);
  });

  it("A5 the curve follows each change of the expression", async () => {
    await open();
    const f = await startFunction();
    typeInto(f, "x^2");
    await settle();
    const first = curveSignature();
    typeInto(f, "-x^2");
    await settle();
    expect(curveSignature()).not.toBe(first);
  });

  it("A5 the curve of a typed expression carries no style attribute", async () => {
    await open();
    const f = await startFunction();
    typeInto(f, "sin(x)/x");
    await settle();
    expect(host.querySelectorAll("[style]")).toHaveLength(0);
  });

  it("A5 Esc in the expression field closes the field and does not commit the drawing", async () => {
    const done = await open();
    const f = await startFunction();
    key(f, "Escape");
    await settle();
    expect(field()).toBeNull();
    expect(done).not.toHaveBeenCalled();
  });

  it("A6 the LaTeX form \\frac{1}{x} is accepted: not boxed and the commit goes through", async () => {
    const done = await open();
    const f = await startFunction();
    typeInto(f, "\\frac{1}{x}");
    await settle();
    expect(boxed("\\frac{1}{x}")).toHaveLength(0);
    key(f, "Enter");
    await settle();
    clickDone();
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("A6 plain math with functions and constants is accepted: not boxed", async () => {
    await open();
    const f = await startFunction();
    typeInto(f, "exp(-x^2) + abs(x) * pi");
    await settle();
    expect(boxed("exp(-x^2)")).toHaveLength(0);
    expect(named("exp(-x^2)")).toHaveLength(0);
  });
});

describe("broken expressions", () => {
  const BAD = "sin(";

  it("A6 an expression that does not parse is shown in a box with an error class", async () => {
    await open();
    const f = await startFunction();
    typeInto(f, BAD);
    await settle();
    expect(boxed(BAD).length > 0 || f.className.includes("error") || f.getAttribute("aria-invalid") === "true").toBe(true);
  });

  it("A6 the editor names the broken expression", async () => {
    await open();
    const f = await startFunction();
    typeInto(f, BAD);
    await settle();
    expect(named(BAD).length).toBeGreaterThan(0);
  });

  it("A6 Done does not commit while the expression is broken", async () => {
    const done = await open();
    const f = await startFunction();
    typeInto(f, BAD);
    await settle();
    clickDone();
    await settle();
    expect(done).not.toHaveBeenCalled();
  });

  it("A6 Esc on the canvas does not commit while the expression is broken", async () => {
    const done = await open();
    const f = await startFunction();
    typeInto(f, BAD);
    key(f, "Enter");
    await settle();
    key(canvas(), "Escape");
    await settle();
    expect(done).not.toHaveBeenCalled();
  });

  it("A6 a click outside does not commit while the expression is broken", async () => {
    const done = await open();
    const f = await startFunction();
    typeInto(f, BAD);
    await settle();
    const other = document.createElement("div");
    document.body.append(other);
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) other.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
    await settle();
    expect(done).not.toHaveBeenCalled();
  });

  it("A6 fixing the expression clears the box, the name and the block", async () => {
    const done = await open();
    const f = await startFunction();
    typeInto(f, BAD);
    await settle();
    clickDone();
    typeInto(theField(), "sin(x)");
    await settle();
    expect(boxed(BAD)).toHaveLength(0);
    expect(named(BAD)).toHaveLength(0);
    clickDone();
    expect(done).toHaveBeenCalledTimes(1);
    const fn = lastModel(done).items.find((i) => i.k === "fn") as unknown as { expr: string };
    expect(fn.expr).toContain("sin");
  });

  it("A6 a bad expression never reaches the committed model", async () => {
    const done = await open();
    const f = await startFunction();
    typeInto(f, BAD);
    await settle();
    clickDone();
    typeInto(theField(), "cos(x)");
    await settle();
    clickDone();
    const exprs = lastModel(done).items.filter((i) => i.k === "fn").map((i) => (i as unknown as { expr: string }).expr);
    expect(exprs.every((e) => e !== BAD)).toBe(true);
  });
});
