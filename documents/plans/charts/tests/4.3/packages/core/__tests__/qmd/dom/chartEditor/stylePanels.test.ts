/** @jest-environment jsdom */
/**
 * Tests renderStylePanel (plan charts, spec 4.3, D9): the General, Traces, Axes and Legend panels read a model and report a new model for each committed change.
 * Controls are found by accessible name (label text), never by class; every panel keeps a heading that names its settings.
 */
import { emptyChart, type ChartModel, type ChartTable, type ChartTrace } from "../../../../src/qmd/chart/model";
import { renderStylePanel } from "../../../../src/qmd/dom/chartEditor/stylePanels";
import { closeMenu } from "../../../../src/ui/dom/widgets/menu";
import { chooseOption, controls, nameOf } from "./chartEditorHarness";

const TABLE: ChartTable = {
  cols: [
    { name: "t", values: [1, 2, 3] },
    { name: "v", values: [10, 20, 30] },
    { name: "w", values: [5, 6, 7] },
  ],
};

const LINE: ChartTrace = { type: "scatter", x: "A", y: "B", mode: "lines" };
const BARS: ChartTrace = { type: "bar", x: "A", y: "C" };
const SURFACE: ChartTrace = { type: "surface", z: ["B", "C"] };

type Anything = Record<string, unknown>;

function model(traces: ChartTrace[], layout: Anything = {}, extra: Anything = {}): ChartModel {
  const base = emptyChart("data", "a1b2c3d4");
  return { ...base, data: TABLE, traces, layout: { ...base.layout, ...layout }, ...extra } as ChartModel;
}

interface Panel { el: HTMLElement; calls: ChartModel[]; last(): ChartModel }

let attached: HTMLElement[] = [];

function panel(which: "general" | "traces" | "axes" | "legend", m: ChartModel): Panel {
  const calls: ChartModel[] = [];
  const el = renderStylePanel(which, m, (next) => { calls.push(next); });
  document.body.append(el);
  attached.push(el);
  return { el, calls, last: () => calls[calls.length - 1]! };
}

afterEach(() => {
  for (const el of attached) el.remove();
  attached = [];
  closeMenu();
});

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

/** The hex input of the nth colour field: in the panel, or in the menu the colour control opens. */
function hexInput(scope: ParentNode, nth = 0): HTMLInputElement {
  const find = (root: ParentNode, at: number): HTMLInputElement | undefined => inputsNamed(root, /hex|colou?r/i).filter((el) => el.type === "text")[at];
  const direct = find(scope, nth);
  if (direct !== undefined) return direct;
  controls(scope, /colou?r/i).filter((el) => el.tagName === "BUTTON")[nth]?.click();
  const opened = find(document, 0);
  if (opened === undefined) throw new Error("no hex field for the colour control");
  return opened;
}

function labelled(el: HTMLElement): boolean {
  const by = (el.getAttribute("aria-labelledby") ?? "").split(/\s+/).filter((id) => id !== "");
  if (by.some((id) => (document.getElementById(id)?.textContent ?? "").trim() !== "")) return true;
  if (el.id !== "" && [...document.querySelectorAll("label")].some((l) => l.htmlFor === el.id && (l.textContent ?? "").trim() !== "")) return true;
  return (el.closest("label")?.textContent ?? "").trim() !== "";
}

describe("4.3a panels in general", () => {
  const PANELS = ["general", "traces", "axes", "legend"] as const;

  test.each(PANELS)("4.3a the %s panel names its settings in a heading line", (which) => {
    const p = panel(which, model([LINE]));
    expect((p.el.textContent ?? "").toLowerCase()).toContain(which);
  });

  test.each(PANELS)("4.3a every control of the %s panel has an accessible name", (which) => {
    const p = panel(which, model([LINE, SURFACE], { zaxis: { type: "linear" } }));
    const unnamed = [...p.el.querySelectorAll<HTMLElement>("button, select, input, textarea")].filter((el) => nameOf(el) === "");
    expect(unnamed.map((el) => el.outerHTML)).toEqual([]);
  });

  test.each(PANELS)("4.3a every input of the %s panel has a visible label tied to it", (which) => {
    const p = panel(which, model([LINE, SURFACE], { zaxis: { type: "linear" } }));
    const fields = [...p.el.querySelectorAll<HTMLElement>("select, textarea, input")].filter((el) => !(el instanceof HTMLInputElement && el.type === "hidden"));
    expect(fields.length).toBeGreaterThan(0);
    expect(fields.filter((el) => !labelled(el)).map((el) => el.outerHTML)).toEqual([]);
  });

  test.each(PANELS)("4.3a opening the %s panel reports no change", (which) => {
    const p = panel(which, model([LINE]));
    expect(p.calls).toHaveLength(0);
  });
});

describe("4.3a General", () => {
  test("4.3a General sets the chart title", () => {
    const p = panel("general", model([LINE]));
    commit(input(p.el, /title/i), "Decay");
    expect(p.calls).toHaveLength(1);
    expect(p.last().title).toBe("Decay");
  });

  test("4.3a General shows the current title", () => {
    const p = panel("general", model([LINE], {}, { title: "Decay" }));
    expect(input(p.el, /title/i).value).toBe("Decay");
  });

  test("4.3a General removes the title key when the title is emptied", () => {
    const p = panel("general", model([LINE], {}, { title: "Decay" }));
    commit(input(p.el, /title/i), "");
    expect(p.calls).toHaveLength(1);
    expect("title" in p.last()).toBe(false);
  });

  test("4.3a General sets the width and the height", () => {
    const p = panel("general", model([LINE]));
    commit(input(p.el, /width/i), "640");
    expect(lay(p.last()).width).toBe(640);
    const q = panel("general", model([LINE]));
    commit(input(q.el, /height/i), "360");
    expect(lay(q.last()).height).toBe(360);
  });

  test("4.3a General sets the font size", () => {
    const p = panel("general", model([LINE]));
    commit(input(p.el, /font size/i), "14");
    expect(p.calls).toHaveLength(1);
    expect(lay(p.last()).fontSize).toBe(14);
  });

  test("4.3a General shows the current font size", () => {
    const p = panel("general", model([LINE], { fontSize: 18 }));
    expect(Number(input(p.el, /font size/i).value)).toBe(18);
  });

  test("4.3a General does not report a font size while it is being typed", () => {
    const p = panel("general", model([LINE]));
    const field = input(p.el, /font size/i);
    field.value = "1";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    expect(p.calls).toHaveLength(0);
  });

  test("4.3a General removes the font size key when it is emptied", () => {
    const p = panel("general", model([LINE], { fontSize: 18 }));
    commit(input(p.el, /font size/i), "");
    expect(p.calls).toHaveLength(1);
    expect("fontSize" in lay(p.last())).toBe(false);
  });

  test("4.3a General sets the default colour scale", () => {
    const p = panel("general", model([{ type: "heatmap", z: ["B", "C"] }]));
    choose(p.el, /colou?r ?scale/i, "Blues", /^blues$/i);
    expect(lay(p.last()).colorscale).toBe("Blues");
  });

  test("4.3a General sets the bar mode to stacked and to grouped", () => {
    const p = panel("general", model([BARS]));
    choose(p.el, /bar ?mode|barmode/i, "stack", /^stack/i);
    expect(lay(p.last()).barmode).toBe("stack");
    const q = panel("general", model([BARS], { barmode: "stack" }));
    choose(q.el, /bar ?mode|barmode/i, "group", /^group/i);
    expect(lay(q.last()).barmode).toBe("group");
  });

  test("4.3a General keeps every other part of the model", () => {
    const m = model([LINE, BARS], { legend: { show: false }, width: 500 }, { title: "Keep" });
    const p = panel("general", m);
    commit(input(p.el, /font size/i), "12");
    const next = p.last();
    expect(next.traces).toEqual(m.traces);
    expect(next.data).toEqual(m.data);
    expect(next.title).toBe("Keep");
    expect(lay(next).legend).toEqual({ show: false });
    expect(lay(next).width).toBe(500);
  });

  test("4.3a General reports a new model and leaves the old one untouched", () => {
    const m = model([LINE]);
    const before = JSON.parse(JSON.stringify(m)) as typeof m;
    const p = panel("general", m);
    commit(input(p.el, /font size/i), "12");
    expect(p.last()).not.toBe(m);
    expect(lay(p.last())).not.toBe(m.layout);
    expect(m).toEqual(before);
  });
});

describe("4.3b Traces", () => {
  test("4.3b Traces sets a trace's colour from its hex field", () => {
    const p = panel("traces", model([LINE]));
    commit(hexInput(p.el), "#336699");
    expect(p.calls).toHaveLength(1);
    expect(p.last().traces[0]!.color).toBe("#336699");
  });

  test("4.3b Traces sets a trace's opacity", () => {
    const p = panel("traces", model([LINE]));
    commit(input(p.el, /opacity/i), "0.5");
    expect(p.calls).toHaveLength(1);
    expect(p.last().traces[0]!.opacity).toBe(0.5);
  });

  test("4.3b Traces shows a trace's current opacity", () => {
    const p = panel("traces", model([{ ...LINE, opacity: 0.3 }]));
    expect(Number(input(p.el, /opacity/i).value)).toBe(0.3);
  });

  test("4.3b Traces removes the opacity key when it is emptied", () => {
    const p = panel("traces", model([{ ...LINE, opacity: 0.3 }]));
    commit(input(p.el, /opacity/i), "");
    expect(p.calls).toHaveLength(1);
    expect("opacity" in p.last().traces[0]!).toBe(false);
  });

  test("4.3b Traces sets the mode of a scatter trace", () => {
    const p = panel("traces", model([LINE]));
    choose(p.el, /mode/i, "markers", /^markers$/i);
    expect(p.last().traces[0]!.mode).toBe("markers");
  });

  test("4.3b Traces sets the line width", () => {
    const p = panel("traces", model([LINE]));
    commit(input(p.el, /line width/i), "3");
    expect(p.last().traces[0] as unknown as Anything).toMatchObject({ lineWidth: 3 });
  });

  test("4.3b Traces sets the marker size", () => {
    const p = panel("traces", model([{ ...LINE, mode: "markers" }]));
    commit(input(p.el, /marker size/i), "8");
    expect(p.last().traces[0] as unknown as Anything).toMatchObject({ markerSize: 8 });
  });

  test("4.3b Traces sets the fill of a scatter trace", () => {
    const p = panel("traces", model([LINE]));
    choose(p.el, /fill/i, "tozeroy", /^fill/i);
    expect(p.last().traces[0]!.fill).toBe("tozeroy");
  });

  test("4.3b Traces edits only the trace whose controls were used", () => {
    const p = panel("traces", model([LINE, BARS]));
    commit(input(p.el, /opacity/i, 1), "0.6");
    expect(p.last().traces[0]).toEqual(LINE);
    expect(p.last().traces[1]).toMatchObject({ type: "bar", x: "A", y: "C", opacity: 0.6 });
    expect(p.last().traces).toHaveLength(2);
  });

  test("4.3b Traces offers an opacity field for each trace", () => {
    const p = panel("traces", model([LINE, BARS, SURFACE]));
    expect(inputsNamed(p.el, /opacity/i)).toHaveLength(3);
  });

  test("4.3b Traces keeps the rest of the trace and the model", () => {
    const m = model([{ ...LINE, name: "run 1" }], {}, { title: "Keep" });
    const p = panel("traces", m);
    commit(input(p.el, /opacity/i), "0.5");
    expect(p.last().traces[0]).toEqual({ ...LINE, name: "run 1", opacity: 0.5 });
    expect(p.last().title).toBe("Keep");
    expect(p.last().layout).toEqual(m.layout);
  });

  test("4.3b Traces reports a new model and leaves the old one untouched", () => {
    const m = model([LINE]);
    const before = JSON.parse(JSON.stringify(m)) as typeof m;
    const p = panel("traces", m);
    commit(input(p.el, /opacity/i), "0.5");
    expect(p.last()).not.toBe(m);
    expect(p.last().traces).not.toBe(m.traces);
    expect(m).toEqual(before);
  });
});

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

describe("4.3b Legend", () => {
  test("4.3b Legend shows whether the legend is visible", () => {
    expect(isOn(toggleOf(panel("legend", model([LINE])).el, /show|visible/i))).toBe(true);
    expect(isOn(toggleOf(panel("legend", model([LINE], { legend: { show: false } })).el, /show|visible/i))).toBe(false);
  });

  test("4.3b Legend hides the legend", () => {
    const p = panel("legend", model([LINE]));
    toggleOf(p.el, /show|visible/i).click();
    expect(p.calls).toHaveLength(1);
    expect((lay(p.last()).legend as Anything).show).toBe(false);
  });

  test("4.3b Legend shows the legend again", () => {
    const p = panel("legend", model([LINE], { legend: { show: false } }));
    toggleOf(p.el, /show|visible/i).click();
    expect((lay(p.last()).legend as Anything).show).toBe(true);
  });

  test("4.3b Legend sets the orientation to horizontal and to vertical", () => {
    const p = panel("legend", model([LINE]));
    choose(p.el, /orientation/i, "h", /^horizontal$/i);
    expect((lay(p.last()).legend as Anything).orientation).toBe("h");
    const q = panel("legend", model([LINE], { legend: { show: true, orientation: "h" } }));
    choose(q.el, /orientation/i, "v", /^vertical$/i);
    expect((lay(q.last()).legend as Anything).orientation).toBe("v");
  });

  test("4.3b Legend offers a position control that moves the legend", () => {
    const p = panel("legend", model([LINE]));
    const control = controls(p.el, /position/i)[0];
    expect(control).toBeDefined();
    if (control instanceof HTMLSelectElement) {
      const other = [...control.options].find((o) => o.value !== control.value)!;
      chooseOption(control, other.value);
    } else if (control instanceof HTMLInputElement) {
      commit(control, "0.9");
    } else {
      control!.click();
    }
    const legend = lay(p.last()).legend as Anything;
    expect(typeof legend.x === "number" || typeof legend.y === "number").toBe(true);
  });

  test("4.3b Legend keeps the show flag when the orientation changes", () => {
    const p = panel("legend", model([LINE], { legend: { show: false } }));
    choose(p.el, /orientation/i, "h", /^horizontal$/i);
    expect(lay(p.last()).legend).toMatchObject({ show: false, orientation: "h" });
  });

  test("4.3b Legend reports a new model and leaves the old one untouched", () => {
    const m = model([LINE]);
    const before = JSON.parse(JSON.stringify(m)) as typeof m;
    const p = panel("legend", m);
    toggleOf(p.el, /show|visible/i).click();
    expect(p.last()).not.toBe(m);
    expect(lay(p.last()).legend).not.toBe(lay(m).legend);
    expect(m).toEqual(before);
  });
});
