/** @jest-environment jsdom */
/**
 * Tests openDrawingEditor in jsdom: toolbar buttons with accessible names and shortcuts, the canvas answering to pointer and
 * keyboard events, Done/Esc/outside click committing the model, and no style= attribute anywhere in the editor DOM.
 * Only the public seam is used: the host element, the model going in and the model handed to `done`.
 * MathJax is reached only through loadCoreMath of src/latex/hover/index, which is mocked here. A7 bundles the editor with esbuild.
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { openDrawingEditor } from "../../../../src/qmd/dom/drawingEditor/openDrawingEditor";

// MathJax is not loaded in these tests: loadCoreMath resolves to a stub whose every function returns an empty svg.
jest.mock("../../../../src/latex/hover/index", () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"></svg>';
  const stub: unknown = new Proxy(
    {},
    {
      get: (_target, prop) => (prop === "then" ? undefined : () => svg),
    },
  );
  return { __esModule: true, loadCoreMath: jest.fn(() => Promise.resolve(stub)) };
});

type Model = Parameters<typeof openDrawingEditor>[1];

const EMPTY: Model = { v: 1, points: [], items: [] };
const FULL: Model = {
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

let host: HTMLElement;
let handle: { destroy(): void } | undefined;
afterEach(() => {
  handle?.destroy();
  handle = undefined;
  document.body.innerHTML = "";
});

const settle = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

async function open(model: Model = EMPTY) {
  host = document.createElement("div");
  document.body.append(host);
  const done = jest.fn<void, [Model | null]>();
  handle = openDrawingEditor(host, model, done);
  await settle();
  return done;
}

const nameOf = (el: Element) => el.getAttribute("aria-label") || (el.textContent ?? "").trim() || el.getAttribute("title") || "";
const buttons = () => Array.from(host.querySelectorAll<HTMLElement>("button, [role='button']"));
function button(name: RegExp): HTMLElement {
  const found = buttons().filter((b) => name.test(nameOf(b)));
  if (found.length !== 1) throw new Error(`expected one button named ${name}, found ${found.length}: ${buttons().map(nameOf).join(" | ")}`);
  return found[0]!;
}
const isDisabled = (el: HTMLElement) => (el as HTMLButtonElement).disabled === true || el.getAttribute("aria-disabled") === "true";
const canvas = (): SVGSVGElement => {
  const svg = Array.from(host.querySelectorAll<SVGSVGElement>("svg")).find((s) => !s.closest("button, [role='toolbar']"));
  if (!svg) throw new Error("no canvas svg in the editor");
  return svg;
};
const FIELD = 'input:not([type="color"]):not([type="range"]):not([type="checkbox"]):not([type="button"]), textarea';
const field = () => host.querySelector<HTMLInputElement | HTMLTextAreaElement>(FIELD);

function pointer(type: string, target: Element, x: number, y: number, init: MouseEventInit = {}) {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === "pointerup" ? 0 : 1, ...init }));
}
function drag(target: Element, from: [number, number], to: [number, number]) {
  pointer("pointerdown", target, ...from);
  pointer("pointermove", target, (from[0] + to[0]) / 2, (from[1] + to[1]) / 2);
  pointer("pointermove", target, ...to);
  pointer("pointerup", target, ...to);
}
function click(target: Element, x: number, y: number) {
  pointer("pointerdown", target, x, y);
  pointer("pointerup", target, x, y);
  pointer("click", target, x, y);
}
const key = (target: Element, k: string, init: KeyboardEventInit = {}) => target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init }));
/** Closes a label or expression field the editor opened by itself, so the next step starts from the canvas. */
function closeField() {
  const f = field();
  if (f) key(f, "Escape");
}
async function addPointWithTool(x: number, y: number) {
  button(/^point\b/i).click();
  click(canvas(), x, y);
  await settle();
}
function outsideClick() {
  const other = document.createElement("div");
  document.body.append(other);
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) other.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
}
const lastModel = (done: jest.Mock<void, [Model | null]>) => done.mock.calls[0]![0] as Model;
const countOf = (done: jest.Mock<void, [Model | null]>) => done.mock.calls.length;

const TOOLS: Array<[string, RegExp, string]> = [
  ["Select", /^select\b/i, "V"],
  ["Point", /^point\b/i, "P"],
  ["Line", /^line\b/i, "L"],
  ["Arrow", /^arrow\b/i, "A"],
  ["Circle", /^circle\b/i, "C"],
  ["Rectangle", /^rect(angle)?\b/i, "R"],
  ["Function", /^function\b/i, "F"],
  ["Label", /^label\b/i, "T"],
];

describe("openDrawingEditor toolbar", () => {
  it.each(TOOLS)("A8 toolbar has a %s button", async (_label, name) => {
    await open();
    expect(button(name)).toBeTruthy();
  });

  it.each(TOOLS)("A8 the %s button carries its shortcut letter in the title", async (_label, name, shortcut) => {
    await open();
    expect(button(name).getAttribute("title") ?? "").toMatch(new RegExp(`\\b${shortcut}\\b`));
  });

  it.each(["undo", "redo", "done"])("A8 toolbar has a %s button", async (label) => {
    await open();
    expect(button(new RegExp(`^${label}\\b`, "i"))).toBeTruthy();
  });

  it.each(["colou?r", "dash", "thick"])("A8 toolbar has a %s control", async (label) => {
    await open();
    const control = Array.from(host.querySelectorAll<HTMLElement>("button, [role], input, select")).filter((e) => new RegExp(label, "i").test(nameOf(e) || e.getAttribute("title") || ""));
    expect(control.length).toBeGreaterThan(0);
  });

  it("A8 every button in the editor has an accessible name", async () => {
    await open(FULL);
    const unnamed = buttons().filter((b) => nameOf(b).trim() === "");
    expect(unnamed).toHaveLength(0);
  });

  it("A8 Select is the active tool at first, marked by aria-pressed and not by colour alone", async () => {
    await open();
    expect(button(/^select\b/i).getAttribute("aria-pressed")).toBe("true");
    expect(button(/^line\b/i).getAttribute("aria-pressed")).toBe("false");
  });

  it.each(TOOLS.slice(1))("A8 clicking the %s button makes it the active tool and releases Select", async (_label, name) => {
    await open();
    button(name).click();
    expect(button(name).getAttribute("aria-pressed")).toBe("true");
    expect(button(/^select\b/i).getAttribute("aria-pressed")).toBe("false");
  });

  it.each(TOOLS.slice(1))("A8 pressing %s on the canvas switches tool by its shortcut", async (_label, name, shortcut) => {
    await open();
    key(canvas(), shortcut.toLowerCase());
    expect(button(name).getAttribute("aria-pressed")).toBe("true");
  });

  it("A8 undo and redo start disabled", async () => {
    await open();
    expect(isDisabled(button(/^undo\b/i))).toBe(true);
    expect(isDisabled(button(/^redo\b/i))).toBe(true);
  });
});

describe("openDrawingEditor commit", () => {
  it("A8 returns a handle with destroy", async () => {
    await open();
    expect(typeof handle?.destroy).toBe("function");
  });

  it("A8 Done calls done with the model", async () => {
    const done = await open(FULL);
    button(/^done\b/i).click();
    expect(countOf(done)).toBe(1);
    expect(lastModel(done)).toEqual(FULL);
  });

  it("A8 Esc commits: done is called with the model", async () => {
    const done = await open(FULL);
    key(canvas(), "Escape");
    expect(countOf(done)).toBe(1);
    expect(lastModel(done)).toEqual(FULL);
  });

  it("A8 a click outside the editor commits", async () => {
    const done = await open(FULL);
    outsideClick();
    expect(countOf(done)).toBe(1);
    expect(lastModel(done)).toEqual(FULL);
  });

  it("A8 a click on the canvas does not commit", async () => {
    const done = await open(FULL);
    click(canvas(), 60, 60);
    expect(countOf(done)).toBe(0);
  });

  it("A8 a click on a toolbar button other than Done does not commit", async () => {
    const done = await open(FULL);
    button(/^line\b/i).click();
    expect(countOf(done)).toBe(0);
  });

  it("A8 commits once however many ways are used", async () => {
    const done = await open(FULL);
    button(/^done\b/i).click();
    key(canvas(), "Escape");
    outsideClick();
    expect(countOf(done)).toBe(1);
  });

  it("A8 an empty drawing commits as an empty model", async () => {
    const done = await open(EMPTY);
    button(/^done\b/i).click();
    expect(lastModel(done)).toEqual(EMPTY);
  });

  it("A8 does not mutate the model it was given", async () => {
    const model = JSON.parse(JSON.stringify(FULL)) as Model;
    await open(model);
    await addPointWithTool(60, 60);
    expect(model).toEqual(FULL);
  });

  it("A8 destroy removes the editor from the host", async () => {
    await open(FULL);
    handle!.destroy();
    expect(host.querySelector("svg")).toBeNull();
    expect(buttons()).toHaveLength(0);
  });

  it("A8 after destroy neither Esc nor an outside click commits", async () => {
    const done = await open(FULL);
    const target = canvas();
    handle!.destroy();
    key(target, "Escape");
    key(document.body, "Escape");
    outsideClick();
    expect(countOf(done)).toBe(0);
  });
});

describe("openDrawingEditor canvas", () => {
  it("A8 draws the drawing into an svg canvas", async () => {
    await open(FULL);
    expect(canvas().querySelectorAll("*").length).toBeGreaterThan(5);
  });

  it("A8 the Point tool adds a point to the committed model", async () => {
    const done = await open();
    await addPointWithTool(60, 60);
    button(/^done\b/i).click();
    expect(lastModel(done).points).toHaveLength(1);
  });

  it("A8 gives each new point an id", async () => {
    const done = await open();
    await addPointWithTool(60, 60);
    await addPointWithTool(200, 60);
    button(/^done\b/i).click();
    const ids = lastModel(done).points.map((p) => p.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids.every((id) => typeof id === "string" && id.length > 0)).toBe(true);
  });

  it("A8 renders a new point live, before any commit", async () => {
    await open();
    const before = canvas().querySelectorAll("*").length;
    await addPointWithTool(60, 60);
    expect(canvas().querySelectorAll("*").length).toBeGreaterThan(before);
  });

  it("A8 double-click on empty canvas makes a point", async () => {
    const done = await open();
    canvas().dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, clientX: 60, clientY: 60 }));
    await settle();
    closeField();
    button(/^done\b/i).click();
    expect(lastModel(done).points).toHaveLength(1);
  });

  it("A8 the Circle tool drags out a circle", async () => {
    const done = await open();
    button(/^circle\b/i).click();
    drag(canvas(), [60, 60], [120, 60]);
    button(/^done\b/i).click();
    expect(lastModel(done).items.filter((i) => i.k === "circle")).toHaveLength(1);
  });

  it("A8 the Rectangle tool drags out a rectangle", async () => {
    const done = await open();
    button(/^rect(angle)?\b/i).click();
    drag(canvas(), [60, 60], [160, 120]);
    button(/^done\b/i).click();
    expect(lastModel(done).items.filter((i) => i.k === "rect")).toHaveLength(1);
  });

  it("A8 the Function tool drags a box that becomes axes", async () => {
    const done = await open();
    button(/^function\b/i).click();
    drag(canvas(), [60, 60], [260, 200]);
    await settle();
    closeField();
    button(/^done\b/i).click();
    expect(lastModel(done).items.filter((i) => i.k === "axes")).toHaveLength(1);
  });

  it("A8 undo takes back the last gesture and redo restores it", async () => {
    const done = await open();
    await addPointWithTool(60, 60);
    expect(isDisabled(button(/^undo\b/i))).toBe(false);
    button(/^undo\b/i).click();
    expect(isDisabled(button(/^redo\b/i))).toBe(false);
    button(/^redo\b/i).click();
    button(/^done\b/i).click();
    expect(lastModel(done).points).toHaveLength(1);
  });

  it("A8 undo leaves the model without the gesture", async () => {
    const done = await open();
    await addPointWithTool(60, 60);
    button(/^undo\b/i).click();
    button(/^done\b/i).click();
    expect(lastModel(done).points).toHaveLength(0);
  });

  it("A8 Cmd+Z and Shift+Cmd+Z undo and redo a gesture inside the editor", async () => {
    const done = await open();
    await addPointWithTool(60, 60);
    key(canvas(), "z", { metaKey: true, ctrlKey: true });
    expect(isDisabled(button(/^redo\b/i))).toBe(false);
    key(canvas(), "z", { metaKey: true, ctrlKey: true, shiftKey: true });
    button(/^done\b/i).click();
    expect(lastModel(done).points).toHaveLength(1);
  });

  it("A8 a few gestures are separate undo steps", async () => {
    const done = await open();
    await addPointWithTool(60, 60);
    await addPointWithTool(200, 60);
    button(/^undo\b/i).click();
    button(/^done\b/i).click();
    expect(lastModel(done).points).toHaveLength(1);
  });

  it("A8 a new point lets the canvas grow to hold it", async () => {
    await open(EMPTY);
    const attr = (svg: SVGSVGElement) => `${svg.getAttribute("viewBox") ?? ""}|${svg.getAttribute("width") ?? ""}|${svg.getAttribute("height") ?? ""}`;
    const before = attr(canvas());
    await addPointWithTool(1500, 1200);
    expect(attr(canvas())).not.toBe(before);
  });
});

describe("openDrawingEditor and style attributes", () => {
  it("A8 the editor DOM has no style attribute when opened on an empty drawing", async () => {
    await open(EMPTY);
    expect(host.querySelectorAll("[style]")).toHaveLength(0);
    expect(host.innerHTML).not.toMatch(/\sstyle\s*=/i);
  });

  it("A8 the editor DOM has no style attribute when opened on a full drawing", async () => {
    await open(FULL);
    expect(host.querySelectorAll("[style]")).toHaveLength(0);
    expect(host.innerHTML).not.toMatch(/\sstyle\s*=/i);
  });

  it("A8 the editor puts no style element in the DOM", async () => {
    await open(FULL);
    expect(host.querySelectorAll("style")).toHaveLength(0);
  });

  it("A8 no style attribute after switching tools and drawing", async () => {
    await open(FULL);
    button(/^circle\b/i).click();
    drag(canvas(), [60, 60], [120, 60]);
    button(/^rect(angle)?\b/i).click();
    drag(canvas(), [140, 60], [220, 120]);
    await addPointWithTool(300, 90);
    button(/^function\b/i).click();
    drag(canvas(), [60, 160], [260, 300]);
    await settle();
    expect(host.querySelectorAll("[style]")).toHaveLength(0);
  });

  it("A8 no style attribute during a drag in progress", async () => {
    await open(FULL);
    button(/^rect(angle)?\b/i).click();
    pointer("pointerdown", canvas(), 60, 60);
    pointer("pointermove", canvas(), 150, 110);
    expect(host.querySelectorAll("[style]")).toHaveLength(0);
    pointer("pointerup", canvas(), 150, 110);
  });

  it("A8 no style attribute after undo and redo", async () => {
    await open(FULL);
    await addPointWithTool(300, 90);
    button(/^undo\b/i).click();
    button(/^redo\b/i).click();
    expect(host.querySelectorAll("[style]")).toHaveLength(0);
  });

  it("A8 no inline event handler attribute in the editor DOM", async () => {
    await open(FULL);
    const withHandlers = Array.from(host.querySelectorAll("*")).filter((e) => e.getAttributeNames().some((n) => n.startsWith("on")));
    expect(withHandlers).toHaveLength(0);
  });
});

describe("openDrawingEditor bundle size", () => {
  it("A7 the editor bundles to at most 60 KB minified, MathJax not counted", () => {
    // __dirname is <repo>/packages/core/__tests__/qmd/dom/drawingEditor: six levels up is the repo root.
    const root = path.resolve(__dirname, "../../../../../..");
    const esbuild = path.join(root, "node_modules", ".bin", "esbuild");
    const entry = path.join(root, "packages", "core", "src", "qmd", "dom", "drawingEditor", "openDrawingEditor.ts");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "labshelf-editor-bundle-"));
    try {
      const outfile = path.join(dir, "editor.js");
      const run = spawnSync(
        esbuild,
        [
          entry,
          "--bundle",
          "--minify",
          "--format=esm",
          "--platform=browser",
          "--external:*/latex/hover/index",
          "--external:*/latex/hover/index.js",
          "--loader:.css=empty",
          "--log-level=error",
          `--outfile=${outfile}`,
        ],
        { cwd: root, encoding: "utf8", timeout: 60000 },
      );
      expect(run.error).toBeUndefined();
      expect(run.stderr).toBe("");
      expect(run.status).toBe(0);
      expect(fs.statSync(outfile).size).toBeLessThanOrEqual(61440);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);
});

describe("openDrawingEditor in Chrome's event order", () => {
  // Grid units to canvas px (y down), as the canvas maps them (0.5 cm at 96 px per inch).
  const U = (0.5 / 2.54) * 96;
  const POINT: Model = { v: 1, points: [{ id: "p1", x: 2, y: 3, dot: true }], items: [] } as unknown as Model;
  /** A press as Chrome sends it when the render on pointerdown detached the pressed element: no click and no dblclick follow. */
  function detachedPress(x: number, y: number) {
    const pressed = host.querySelector(".qmd-drawing-content circle") ?? canvas();
    pointer("pointerdown", pressed, x, y);
    pointer("pointerup", canvas(), x, y);
  }

  it("double-pressing an existing point opens its label field without a dblclick event", async () => {
    await open(POINT);
    detachedPress(2 * U, -3 * U);
    detachedPress(2 * U, -3 * U);
    await settle();
    expect(field()).not.toBeNull();
    key(field()!, "Escape");
  });

  it("Enter in a label field gives the focus back to the canvas, where tool keys work again", async () => {
    await open(POINT);
    detachedPress(2 * U, -3 * U);
    detachedPress(2 * U, -3 * U);
    await settle();
    key(field()!, "Enter");
    expect(document.activeElement).toBe(canvas());
    key(document.activeElement!, "l");
    expect(button(/^line\b/i).getAttribute("aria-pressed")).toBe("true");
  });

  it("history keys in the open editor never reach the note", async () => {
    await open(POINT);
    const outer = jest.fn();
    document.body.addEventListener("keydown", outer);
    try {
      key(canvas(), "z", { metaKey: true });
      detachedPress(2 * U, -3 * U);
      detachedPress(2 * U, -3 * U);
      await settle();
      key(field()!, "z", { metaKey: true });
      expect(outer).not.toHaveBeenCalled();
    } finally {
      document.body.removeEventListener("keydown", outer);
    }
  });

  it("the Point tool places a point on an existing segment instead of moving it", async () => {
    const seg = { v: 1, points: [{ id: "p1", x: 2, y: 3, dot: true }, { id: "p2", x: 8, y: 3, dot: true }], items: [{ k: "seg", a: "p1", b: "p2", arrow: "none" }] } as unknown as Model;
    const done = await open(seg);
    button(/^point\b/i).click();
    click(canvas(), 5 * U, -3 * U);
    await settle();
    button(/^done\b/i).click();
    const model = lastModel(done);
    expect(model.points).toHaveLength(3);
    expect(model.points.find((p) => p.id === "p1")).toMatchObject({ x: 2, y: 3 });
  });
});
