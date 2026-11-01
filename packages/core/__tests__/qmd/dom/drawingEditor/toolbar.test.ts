/** @jest-environment jsdom */
/**
 * Tests the openDrawingEditor toolbar in jsdom: buttons with accessible names and shortcuts, and tool switching by button and by key.
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

import { FULL, host, open, nameOf, buttons, button, isDisabled, canvas, key } from "./openDrawingEditorHarness";

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
