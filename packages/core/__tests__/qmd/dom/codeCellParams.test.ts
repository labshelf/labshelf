/** @jest-environment jsdom */
/**
 * Tests the Manipulate controls of the param strip: a param-less Manipulate cell asks for its controls after a normal run,
 * draws them as a strip, and writes them as `#| param:` lines on the first release.
 */
import type { EditorView } from "prosemirror-view";
import { qmdSchema as s } from "../../../src/qmd/editor/qmdSchema";
import { DEBOUNCE, OK, cell, controlsOf, drag, finishNormalRun, flush, mountCell, nameOf, rangeOf, release, useStripLifecycle } from "./cellParamStripHarness";

useStripLifecycle();

describe("4.1d Manipulate controls", () => {
  const MMA = "Manipulate[Plot[a x, {x, 0, 1}], {a, 0, 10, 1}]\n";
  const CONTROLS = [
    { name: "a", kind: "slider", min: 0, max: 10, step: 1, value: 3 },
    { name: "mode", kind: "select", choices: ["x", "y"], value: "y" },
    { name: "on", kind: "checkbox", value: true },
  ];
  const mma = (options = "#| label: sim\n") => s.node("code_cell", { lang: "mathematica", options, code: MMA, info: "{mathematica}" });
  const runButton = (view: EditorView) => view.dom.querySelector<HTMLButtonElement>(".qmd-cell-run")!;

  /** Runs the Manipulate cell, ends the run, and answers the view's follow-up preview with `controls`. */
  async function withControls(): Promise<ReturnType<typeof mountCell>> {
    const m = mountCell([mma()]);
    runButton(m.view).click();
    expect(m.normals()).toHaveLength(1);
    await finishNormalRun(m.view);
    jest.advanceTimersByTime(DEBOUNCE);
    expect(m.previews()).toHaveLength(1);
    m.previews()[0]!.preview!({ ...OK, language: "mathematica", text: "frame", controls: CONTROLS });
    await flush();
    return m;
  }

  it("4.1d no strip is drawn before the cell has run", () => {
    const m = mountCell([mma()]);
    expect(controlsOf(m.view)).toHaveLength(0);
  });

  it("4.1d after a normal run of a param-less Manipulate cell ends, the view asks for one preview with no params", async () => {
    const m = mountCell([mma()]);
    runButton(m.view).click();
    await finishNormalRun(m.view);
    jest.advanceTimersByTime(DEBOUNCE * 5);
    expect(m.previews()).toHaveLength(1);
    expect(m.previews()[0]!.params).toEqual({});
    expect(m.previews()[0]!.language).toBe("mathematica");
  });

  it("4.1d a cell without Manipulate asks for no preview after a run", async () => {
    const m = mountCell([cell("#| label: sim\n")]);
    runButton(m.view).click();
    await finishNormalRun(m.view);
    jest.advanceTimersByTime(DEBOUNCE * 5);
    expect(m.previews()).toHaveLength(0);
  });

  it("4.1d the result's controls draw a strip with their initial values", async () => {
    const m = await withControls();
    const controls = controlsOf(m.view);
    expect(controls.map((el) => nameOf(el).match(/a|mode|on/)?.[0])).toEqual(["a", "mode", "on"]);
    const range = rangeOf(m.view);
    expect(Number(range.min)).toBe(0);
    expect(Number(range.max)).toBe(10);
    expect(Number(range.value)).toBe(3);
    expect((m.view.dom.querySelector("select") as HTMLSelectElement).value).toBe("y");
    expect((m.view.dom.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(true);
  });

  it("4.1d drawing the strip writes nothing to the note", async () => {
    const m = await withControls();
    expect(m.state.docChanges).toBe(0);
    expect(m.options()).toBe("#| label: sim\n");
  });

  it("4.1d the first release writes every control as a #| param line", async () => {
    const m = await withControls();
    const range = rangeOf(m.view);
    drag(range, 6);
    release(range);
    jest.advanceTimersByTime(2000);
    expect(m.options()).toBe('#| label: sim\n#| param: a = slider(0, 10, 6, step = 1)\n#| param: mode = select("x", "y"; "y")\n#| param: on = checkbox(true)\n');
    expect(m.state.docChanges).toBe(1);
  });

  it("4.1d the first release runs once more with all the control values", async () => {
    const m = await withControls();
    const range = rangeOf(m.view);
    drag(range, 6);
    release(range);
    jest.advanceTimersByTime(2000);
    expect(m.normals()).toHaveLength(2);
    expect(m.normals()[1]!.params).toEqual({ a: 6, mode: "y", on: true });
    expect(m.normals()[1]!.optionsAtCall).toContain("#| param: a = slider(0, 10, 6, step = 1)");
  });

  it("4.1d dragging a Manipulate control previews with all control values", async () => {
    const m = await withControls();
    drag(rangeOf(m.view), 5);
    jest.advanceTimersByTime(DEBOUNCE);
    expect(m.previews()).toHaveLength(2);
    expect(m.previews()[1]!.params).toEqual({ a: 5, mode: "y", on: true });
  });

  it("4.1d param lines in the cell win over the result's controls", async () => {
    const m = mountCell([mma("#| label: sim\n#| param: a = slider(0, 10, 2, step = 1)\n")]);
    runButton(m.view).click();
    await finishNormalRun(m.view);
    jest.advanceTimersByTime(DEBOUNCE);
    for (const call of m.previews()) call.preview!({ ...OK, language: "mathematica", controls: CONTROLS });
    await flush();
    expect(controlsOf(m.view)).toHaveLength(1);
    expect(Number(rangeOf(m.view).value)).toBe(2);
  });
});
