/**
 * Shared harness of the openDrawingEditor jsdom tests: the sample models, the jsdom geometry stubs, and the helpers that open the
 * editor and drive its toolbar and canvas. Not a test file. The tests that import it declare the loadCoreMath mock themselves.
 */
import { openDrawingEditor } from "../../../../src/qmd/dom/drawingEditor/openDrawingEditor";

export type Model = Parameters<typeof openDrawingEditor>[1];

export const EMPTY: Model = { v: 1, points: [], items: [] };
export const FULL: Model = {
  v: 1,
  points: [
    { id: "p1", x: 2, y: 3, dot: true, label: "A" },
    { id: "p2", x: 8, y: 3, dot: false },
  ],
  items: [
    { k: "seg", a: "p1", b: "p2", arrow: "end", label: "f", style: { color: "red", dash: "dashed" } },
    { k: "circle", c: "p1", r: 2 },
    { k: "rect", a: "p1", b: "p2" },
    { k: "text", x: 4, y: 6, tex: "x^2" },
    { k: "axes", id: "a1", o: [10, 10], x: [-5, 5], y: [-3, 3], sx: 1, sy: 1, ticks: true },
    { k: "fn", axes: "a1", expr: "sin(x)/x" },
  ],
} as unknown as Model;

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

export let host: HTMLElement;
export let handle: { destroy(): void } | undefined;
afterEach(() => {
  handle?.destroy();
  handle = undefined;
  document.body.innerHTML = "";
});

export const settle = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

export async function open(model: Model = EMPTY) {
  host = document.createElement("div");
  document.body.append(host);
  const done = jest.fn<void, [Model | null]>();
  handle = openDrawingEditor(host, model, done);
  await settle();
  return done;
}

export const nameOf = (el: Element) => el.getAttribute("aria-label") || (el.textContent ?? "").trim() || el.getAttribute("title") || "";
export const buttons = () => Array.from(host.querySelectorAll<HTMLElement>("button, [role='button']"));
export function button(name: RegExp): HTMLElement {
  const found = buttons().filter((b) => name.test(nameOf(b)));
  if (found.length !== 1) throw new Error(`expected one button named ${name}, found ${found.length}: ${buttons().map(nameOf).join(" | ")}`);
  return found[0]!;
}
export const isDisabled = (el: HTMLElement) => (el as HTMLButtonElement).disabled === true || el.getAttribute("aria-disabled") === "true";
export const canvas = (): SVGSVGElement => {
  const svg = Array.from(host.querySelectorAll<SVGSVGElement>("svg")).find((s) => !s.closest("button, [role='toolbar']"));
  if (!svg) throw new Error("no canvas svg in the editor");
  return svg;
};
export const FIELD = 'input:not([type="color"]):not([type="range"]):not([type="checkbox"]):not([type="button"]), textarea';
export const field = () => host.querySelector<HTMLInputElement | HTMLTextAreaElement>(FIELD);

export function pointer(type: string, target: Element, x: number, y: number, init: MouseEventInit = {}) {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === "pointerup" ? 0 : 1, ...init }));
}
export function drag(target: Element, from: [number, number], to: [number, number]) {
  pointer("pointerdown", target, ...from);
  pointer("pointermove", target, (from[0] + to[0]) / 2, (from[1] + to[1]) / 2);
  pointer("pointermove", target, ...to);
  pointer("pointerup", target, ...to);
}
export function click(target: Element, x: number, y: number) {
  pointer("pointerdown", target, x, y);
  pointer("pointerup", target, x, y);
  pointer("click", target, x, y);
}
export const key = (target: Element, k: string, init: KeyboardEventInit = {}) => target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init }));
/** Closes a label or expression field the editor opened by itself, so the next step starts from the canvas. */
export function closeField() {
  const f = field();
  if (f) key(f, "Escape");
}
export async function addPointWithTool(x: number, y: number) {
  button(/^point\b/i).click();
  click(canvas(), x, y);
  await settle();
}
export function outsideClick() {
  const other = document.createElement("div");
  document.body.append(other);
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) other.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
}
export const lastModel = (done: jest.Mock<void, [Model | null]>) => done.mock.calls[0]![0] as Model;
export const countOf = (done: jest.Mock<void, [Model | null]>) => done.mock.calls.length;
