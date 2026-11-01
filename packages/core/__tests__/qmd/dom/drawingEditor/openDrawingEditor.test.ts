/** @jest-environment jsdom */
/**
 * Tests openDrawingEditor in jsdom: Done/Esc/outside click committing the model, no style= attribute anywhere in the editor DOM,
 * its bundle size, and the event order Chrome sends when a render detaches the pressed element.
 * Only the public seam is used: the host element, the model going in and the model handed to `done`.
 * MathJax is reached only through loadCoreMath of src/latex/hover/index, which is mocked here. A7 bundles the editor with esbuild.
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
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

import { EMPTY, FULL, handle, host, settle, open, buttons, button, canvas, field, pointer, drag, click, key, addPointWithTool, outsideClick, lastModel, countOf, type Model } from "./openDrawingEditorHarness";

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
