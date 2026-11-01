/** @jest-environment jsdom */
/**
 * Tests the openDrawingEditor canvas in jsdom: it answering to pointer and keyboard events.
 * MathJax is reached only through loadCoreMath of src/latex/hover/index, which is mocked here.
 */
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

import { EMPTY, FULL, settle, open, button, isDisabled, canvas, drag, key, closeField, addPointWithTool, lastModel } from "./openDrawingEditorHarness";

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
