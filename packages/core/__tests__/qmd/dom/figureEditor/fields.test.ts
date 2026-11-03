/** @jest-environment jsdom */
/**
 * Tests the shared chart editor inputs (plan charts, spec 4.3, D9): numberField and colourField.
 * A number field has a visible label tied to its input, commits on change (blur or Enter) and never on each keystroke, and an empty optional field reports null.
 * A colour field offers the palette as named swatches and a hex field. Controls are found by accessible name.
 */
import { emptyChart, type ChartModel, type ChartTable, type ChartTrace } from "../../../../src/qmd/chart/model";
import { numberField, colourField } from "../../../../src/qmd/dom/figureEditor/fields";
import { renderStylePanel } from "../../../../src/qmd/dom/figureEditor/stylePanels";
import { closeMenu } from "../../../../src/ui/dom/widgets/menu";
import { chooseOption, controls, nameOf, press } from "../chartEditor/chartEditorHarness";

const PALETTE = ["#4e79a7", "#f28e2b", "#e15759", "#76b7b2"];

let attached: HTMLElement[] = [];

function attach(el: HTMLElement): HTMLElement {
  document.body.append(el);
  attached.push(el);
  return el;
}

afterEach(() => {
  for (const el of attached) el.remove();
  attached = [];
  closeMenu();
});

function numberInput(field: HTMLElement, label: RegExp): HTMLInputElement {
  const input = controls(field, label).find((el): el is HTMLInputElement => el instanceof HTMLInputElement);
  if (input === undefined) throw new Error(`no input named ${String(label)} in ${field.outerHTML}`);
  return input;
}

function change(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("4.3a numberField", () => {
  test("4.3a numberField shows its label as visible text", () => {
    const field = attach(numberField("Line width", 2, () => {}));
    expect(field.textContent).toContain("Line width");
  });

  test("4.3a numberField ties its visible label to the input", () => {
    const field = attach(numberField("Line width", 2, () => {}));
    const input = numberInput(field, /line width/i);
    const labelFor = [...document.querySelectorAll("label")].some((l) => l.htmlFor === input.id && input.id !== "" && /line width/i.test(l.textContent ?? ""));
    const labelledby = (input.getAttribute("aria-labelledby") ?? "").split(/\s+/).some((id) => /line width/i.test(document.getElementById(id)?.textContent ?? ""));
    const wrapped = /line width/i.test(input.closest("label")?.textContent ?? "");
    expect(labelFor || labelledby || wrapped).toBe(true);
  });

  test("4.3a numberField shows the current value in its input", () => {
    const field = attach(numberField("Opacity", 0.4, () => {}));
    expect(Number(numberInput(field, /opacity/i).value)).toBe(0.4);
  });

  test("4.3a numberField shows an empty input for a null value", () => {
    const field = attach(numberField("Opacity", null, () => {}, { allowEmpty: true }));
    expect(numberInput(field, /opacity/i).value).toBe("");
  });

  test("4.3a numberField carries step, min and max on its input", () => {
    const field = attach(numberField("Opacity", 0.5, () => {}, { step: 0.1, min: 0, max: 1 }));
    const input = numberInput(field, /opacity/i);
    expect(input.getAttribute("step")).toBe("0.1");
    expect(input.getAttribute("min")).toBe("0");
    expect(input.getAttribute("max")).toBe("1");
  });

  test("4.3a numberField reports a changed value once, as a number", () => {
    const onChange = jest.fn();
    const field = attach(numberField("Font size", 12, onChange));
    change(numberInput(field, /font size/i), "14.5");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(14.5);
  });

  test("4.3a numberField does not report while typing (an input event without a change)", () => {
    const onChange = jest.fn();
    const field = attach(numberField("Font size", 12, onChange));
    const input = numberInput(field, /font size/i);
    input.value = "1";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.value = "14";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(onChange).not.toHaveBeenCalled();
  });

  test("4.3a numberField commits on Enter", () => {
    const onChange = jest.fn();
    const field = attach(numberField("Font size", 12, onChange));
    const input = numberInput(field, /font size/i);
    input.value = "16";
    press(input, "Enter");
    expect(onChange).toHaveBeenLastCalledWith(16);
  });

  test("4.3a numberField with allowEmpty reports null when cleared", () => {
    const onChange = jest.fn();
    const field = attach(numberField("Opacity", 0.5, onChange, { allowEmpty: true }));
    change(numberInput(field, /opacity/i), "");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(null);
  });
});

describe("4.3a colourField", () => {
  const swatches = (field: HTMLElement): HTMLElement[] => {
    const all = new Set<HTMLElement>([
      ...field.querySelectorAll<HTMLElement>("[title][aria-label]"),
      ...document.querySelectorAll<HTMLElement>('[role="menu"] [title][aria-label], [role="menuitem"][title][aria-label]'),
    ]);
    return [...all].filter((el) => !(el instanceof HTMLInputElement));
  };

  const hexInput = (field: HTMLElement): HTMLInputElement | undefined => {
    const find = (root: ParentNode): HTMLInputElement | undefined => controls(root, /hex|colou?r/i).find((el): el is HTMLInputElement => el instanceof HTMLInputElement && el.type === "text");
    const direct = find(field);
    if (direct !== undefined) return direct;
    controls(field, /./).find((el) => el.tagName === "BUTTON")?.click();
    return find(document);
  };

  test("4.3a colourField shows its label as visible text", () => {
    const field = attach(colourField("Colour", "#4e79a7", PALETTE, () => {}));
    expect(field.textContent).toContain("Colour");
  });

  test("4.3a colourField offers at least one named control carrying its label", () => {
    const field = attach(colourField("Colour", "#4e79a7", PALETTE, () => {}));
    expect(controls(field, /colou?r/i).length).toBeGreaterThan(0);
  });

  test("4.3a colourField offers every palette colour as a swatch with a title and an aria-label", () => {
    const field = attach(colourField("Colour", "#4e79a7", PALETTE, () => {}));
    controls(field, /./).find((el) => el.tagName === "BUTTON")?.click();
    const found = swatches(field);
    expect(found.length).toBeGreaterThanOrEqual(PALETTE.length);
    for (const el of found) {
      expect((el.getAttribute("title") ?? "").trim()).not.toBe("");
      expect((el.getAttribute("aria-label") ?? "").trim()).not.toBe("");
    }
  });

  test("4.3a colourField reports a palette colour when a swatch is chosen", () => {
    const onChange = jest.fn();
    const field = attach(colourField("Colour", "#000000", PALETTE, onChange));
    const seen = new Set<Element>();
    for (let i = 0; i < 30 && onChange.mock.calls.length === 0; i++) {
      const next = swatches(field).find((el) => !seen.has(el));
      if (next === undefined) break;
      seen.add(next);
      next.click();
    }
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(PALETTE).toContain((onChange.mock.calls[0] as string[])[0]!.toLowerCase());
  });

  test("4.3a colourField reports a hex value typed in its hex field", () => {
    const onChange = jest.fn();
    const field = attach(colourField("Colour", "#4e79a7", PALETTE, onChange));
    const hex = hexInput(field);
    expect(hex).toBeDefined();
    change(hex!, "#336699");
    expect(onChange).toHaveBeenLastCalledWith("#336699");
  });

  test("4.3a colourField shows the current value in its hex field", () => {
    const field = attach(colourField("Colour", "#4e79a7", PALETTE, () => {}));
    expect(hexInput(field)!.value.toLowerCase()).toBe("#4e79a7");
  });

  test("4.3a every control of a colour field has an accessible name", () => {
    const field = attach(colourField("Colour", "#4e79a7", PALETTE, () => {}));
    controls(field, /./).find((el) => el.tagName === "BUTTON")?.click();
    const unnamed = [...field.querySelectorAll<HTMLElement>("button, input, select")].filter((el) => nameOf(el) === "");
    expect(unnamed.map((el) => el.outerHTML)).toEqual([]);
  });
});

// The Axes panel (renderStylePanel, plan charts, spec 4.3, D9): it reads a model and reports a new model for each committed change.
// Controls are found by accessible name (label text), never by class; every panel keeps a heading that names its settings.
const TABLE: ChartTable = {
  cols: [
    { name: "t", values: [1, 2, 3] },
    { name: "v", values: [10, 20, 30] },
    { name: "w", values: [5, 6, 7] },
  ],
};

const LINE: ChartTrace = { type: "scatter", x: "A", y: "B", mode: "lines" };
const SURFACE: ChartTrace = { type: "surface", z: ["B", "C"] };

type Anything = Record<string, unknown>;

function model(traces: ChartTrace[], layout: Anything = {}, extra: Anything = {}): ChartModel {
  const base = emptyChart("data", "a1b2c3d4");
  return { ...base, data: TABLE, traces, layout: { ...base.layout, ...layout }, ...extra } as ChartModel;
}

interface Panel { el: HTMLElement; calls: ChartModel[]; last(): ChartModel }

function panel(which: "general" | "traces" | "axes" | "legend", m: ChartModel): Panel {
  const calls: ChartModel[] = [];
  const el = renderStylePanel(which, m, (next) => { calls.push(next); });
  attach(el);
  return { el, calls, last: () => calls[calls.length - 1]! };
}

const lay = (m: ChartModel): Anything => m.layout as unknown as Anything;
const axis = (m: ChartModel, key: "xaxis" | "yaxis" | "zaxis"): Anything => lay(m)[key] as Anything;

function inputsNamed(scope: ParentNode, name: RegExp): HTMLInputElement[] {
  return controls(scope, name).filter((el): el is HTMLInputElement => el instanceof HTMLInputElement);
}

function input(scope: ParentNode, name: RegExp, nth = 0): HTMLInputElement {
  const found = inputsNamed(scope, name)[nth];
  if (found === undefined) throw new Error(`no input #${nth} named ${String(name)}`);
  return found;
}

function commit(el: HTMLInputElement, value: string): void {
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

const isOn = (el: HTMLElement): boolean => (el instanceof HTMLInputElement ? el.checked : el.getAttribute("aria-pressed") === "true" || el.getAttribute("aria-checked") === "true");

/** A checkbox (or toggle button) named `name`. */
function toggleOf(scope: ParentNode, name: RegExp, nth = 0): HTMLElement {
  const found = controls(scope, name).filter((el) => (el instanceof HTMLInputElement && el.type === "checkbox") || el.getAttribute("role") === "switch" || el.getAttribute("role") === "checkbox" || el.hasAttribute("aria-pressed"))[nth];
  if (found === undefined) throw new Error(`no toggle #${nth} named ${String(name)}`);
  return found;
}

/** Chooses `want` in the select named `group`, or clicks the segmented button named `option` when the choice is a button group. */
function choose(scope: ParentNode, group: RegExp, want: string, option: RegExp, nth = 0): void {
  const select = controls(scope, group).filter((el): el is HTMLSelectElement => el instanceof HTMLSelectElement)[nth];
  if (select !== undefined) { chooseOption(select, want); return; }
  const button = controls(scope, option).filter((el) => el.tagName === "BUTTON")[nth];
  if (button === undefined) throw new Error(`no choice ${String(group)} / ${String(option)} #${nth}`);
  button.click();
}

describe("4.3a Axes", () => {
  test("4.3a Axes has one group per axis, X and Y, for a 2D chart", () => {
    const p = panel("axes", model([LINE]));
    expect(inputsNamed(p.el, /title/i)).toHaveLength(2);
  });

  test("4.3a Axes adds a Z group when a trace is 3D", () => {
    const p = panel("axes", model([SURFACE]));
    expect(inputsNamed(p.el, /title/i)).toHaveLength(3);
  });

  test("4.3a Axes adds a Z group when the layout has a z axis", () => {
    const p = panel("axes", model([LINE], { zaxis: { type: "linear" } }));
    expect(inputsNamed(p.el, /title/i)).toHaveLength(3);
  });

  test("4.3a Axes sets the x axis title and not the y axis title", () => {
    const p = panel("axes", model([LINE]));
    commit(input(p.el, /title/i, 0), "Time (s)");
    expect(axis(p.last(), "xaxis").title).toBe("Time (s)");
    expect("title" in axis(p.last(), "yaxis")).toBe(false);
  });

  test("4.3a Axes sets the y axis title", () => {
    const p = panel("axes", model([LINE]));
    commit(input(p.el, /title/i, 1), "Signal");
    expect(axis(p.last(), "yaxis").title).toBe("Signal");
    expect("title" in axis(p.last(), "xaxis")).toBe(false);
  });

  test("4.3a Axes sets the z axis title", () => {
    const p = panel("axes", model([SURFACE], { zaxis: { type: "linear" } }));
    commit(input(p.el, /title/i, 2), "Depth");
    expect(axis(p.last(), "zaxis").title).toBe("Depth");
  });

  test("4.3a Axes shows the current axis titles", () => {
    const p = panel("axes", model([LINE], { xaxis: { type: "linear", title: "Time" }, yaxis: { type: "linear", title: "Volts" } }));
    expect(input(p.el, /title/i, 0).value).toBe("Time");
    expect(input(p.el, /title/i, 1).value).toBe("Volts");
  });

  test("4.3a Axes removes the axis title key when it is emptied", () => {
    const p = panel("axes", model([LINE], { xaxis: { type: "linear", title: "Time" } }));
    commit(input(p.el, /title/i, 0), "");
    expect("title" in axis(p.last(), "xaxis")).toBe(false);
  });

  test("4.3a Axes sets the x axis to log", () => {
    const p = panel("axes", model([LINE]));
    choose(p.el, /type|scale/i, "log", /^log$/i, 0);
    expect(p.calls).toHaveLength(1);
    expect(axis(p.last(), "xaxis").type).toBe("log");
    expect(axis(p.last(), "yaxis").type).toBe("linear");
  });

  test("4.3a Axes sets the y axis to log and back to linear", () => {
    const p = panel("axes", model([LINE]));
    choose(p.el, /type|scale/i, "log", /^log$/i, 1);
    expect(axis(p.last(), "yaxis").type).toBe("log");
    expect(axis(p.last(), "xaxis").type).toBe("linear");
    const q = panel("axes", model([LINE], { yaxis: { type: "log" } }));
    choose(q.el, /type|scale/i, "linear", /^linear$/i, 1);
    expect(axis(q.last(), "yaxis").type).toBe("linear");
  });

  test("4.3a Axes shows min and max fields only for a manual range", () => {
    const p = panel("axes", model([LINE]));
    expect(inputsNamed(p.el, /\bmin/i)).toHaveLength(0);
    expect(inputsNamed(p.el, /\bmax/i)).toHaveLength(0);
    controls(p.el, /^manual$/i)[0]!.click();
    expect(inputsNamed(p.el, /\bmin/i).length).toBeGreaterThan(0);
    expect(inputsNamed(p.el, /\bmax/i).length).toBeGreaterThan(0);
  });

  test("4.3a Axes sets a manual range of [min, max] once both numbers are given", () => {
    const p = panel("axes", model([LINE]));
    controls(p.el, /^manual$/i)[0]!.click();
    commit(input(p.el, /\bmin/i, 0), "1");
    commit(input(p.el, /\bmax/i, 0), "100");
    expect(axis(p.last(), "xaxis").range).toEqual([1, 100]);
    expect("range" in axis(p.last(), "yaxis")).toBe(false);
  });

  test("4.3a Axes shows the min and max of a range already in the model", () => {
    const p = panel("axes", model([LINE], { xaxis: { type: "linear", range: [2, 8] } }));
    expect(Number(input(p.el, /\bmin/i, 0).value)).toBe(2);
    expect(Number(input(p.el, /\bmax/i, 0).value)).toBe(8);
  });

  test("4.3a Axes changes one end of an existing range", () => {
    const p = panel("axes", model([LINE], { xaxis: { type: "linear", range: [2, 8] } }));
    commit(input(p.el, /\bmax/i, 0), "20");
    expect(axis(p.last(), "xaxis").range).toEqual([2, 20]);
  });

  test("4.3a Axes removes the range when Auto is chosen", () => {
    const p = panel("axes", model([LINE], { xaxis: { type: "log", range: [2, 8] } }));
    controls(p.el, /^auto$/i)[0]!.click();
    expect("range" in axis(p.last(), "xaxis")).toBe(false);
    expect(axis(p.last(), "xaxis").type).toBe("log");
  });

  test("4.3a Axes sets the tick step and removes it when emptied", () => {
    const p = panel("axes", model([LINE]));
    commit(input(p.el, /tick/i, 0), "5");
    expect(axis(p.last(), "xaxis").ticks).toBe(5);
    const q = panel("axes", model([LINE], { xaxis: { type: "linear", ticks: 5 } }));
    commit(input(q.el, /tick/i, 0), "");
    expect("ticks" in axis(q.last(), "xaxis")).toBe(false);
  });

  test("4.3a Axes toggles the grid lines of the y axis only", () => {
    const p = panel("axes", model([LINE]));
    const box = toggleOf(p.el, /grid/i, 1);
    const was = isOn(box);
    box.click();
    expect(axis(p.last(), "yaxis").grid).toBe(!was);
    expect("grid" in axis(p.last(), "xaxis")).toBe(false);
  });

  test("4.3a Axes hides the grid lines of the x axis when they are shown", () => {
    const p = panel("axes", model([LINE], { xaxis: { type: "linear", grid: true } }));
    const box = toggleOf(p.el, /grid/i, 0);
    expect(isOn(box)).toBe(true);
    box.click();
    expect(axis(p.last(), "xaxis").grid).toBe(false);
  });

  test("4.3a Axes keeps the rest of the layout and the traces", () => {
    const m = model([LINE], { legend: { show: false }, width: 500 });
    const p = panel("axes", m);
    commit(input(p.el, /title/i, 0), "Time");
    expect(lay(p.last()).legend).toEqual({ show: false });
    expect(lay(p.last()).width).toBe(500);
    expect(p.last().traces).toEqual(m.traces);
  });

  test("4.3a Axes reports a new model and leaves the old one untouched", () => {
    const m = model([LINE]);
    const before = JSON.parse(JSON.stringify(m)) as typeof m;
    const p = panel("axes", m);
    commit(input(p.el, /title/i, 0), "Time");
    expect(p.last()).not.toBe(m);
    expect(axis(p.last(), "xaxis")).not.toBe(axis(m, "xaxis"));
    expect(m).toEqual(before);
  });
});
