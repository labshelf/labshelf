/** @jest-environment jsdom */
/**
 * Tests the param strip of the code cell view: native controls for the cell's `#| param:` lines, debounced previews while
 * dragging (at most one in flight), and the write of the param line plus one normal run on release.
 * The strip is found by its native controls (range, select, checkbox) so the module layout stays free.
 */
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { history, undo } from "prosemirror-history";
import { qmdSchema as s } from "../../../src/qmd/editor/qmdSchema";
import { formatOutput } from "../../../src/qmd/item/cellOutput";
import { createCodeCellView } from "../../../src/qmd/dom/codeCellView";
import { createOutputView } from "../../../src/qmd/dom/outputView";
import "../../support/nodeViewHarness"; // jsdom TextEncoder polyfill

const SLIDER = "#| param: speed = slider(0, 10, 5, step = 1)\n";
const OPTIONS = `#| label: sim\n${SLIDER}`;
const CODE = "print(speed)\n";
const DEBOUNCE = 150;

type PreviewDone = (result: unknown) => void;
interface Call { label: string; code: string; language: string; params: unknown; preview: PreviewDone | undefined; optionsAtCall: string }

const views: EditorView[] = [];

beforeEach(() => { jest.useFakeTimers({ doNotFake: ["queueMicrotask"] }); });
afterEach(() => {
  while (views.length > 0) views.pop()!.destroy();
  document.body.innerHTML = "";
  jest.useRealTimers();
});

function cell(options: string, lang = "python") {
  return s.node("code_cell", { lang, options, code: CODE, info: `{${lang}}` });
}

async function resultOutput() {
  const raw = formatOutput({ cell: "sim", source: "000000000000", engine: "python", ran: "2026-10-30", content: "result-text-42\n" });
  return s.node("output", { cell: "sim", source: "000000000000", engine: "python", ran: "2026-10-30", raw });
}

/** Mounts a doc with a run callback recording every call; `docChanges` counts the transactions that changed the doc. */
function mountCell(children: ReturnType<typeof cell>[] | any[], opts: { runnable?: boolean } = {}) {
  const calls: Call[] = [];
  const state = { docChanges: 0 };
  const host = document.createElement("div");
  document.body.append(host);
  let view!: EditorView;
  const run = (label: string, code: string, language: string, params?: unknown, preview?: PreviewDone): void => {
    calls.push({ label, code, language, params, preview, optionsAtCall: view.state.doc.firstChild!.attrs.options as string });
  };
  view = new EditorView(host, {
    state: EditorState.create({ doc: s.node("doc", null, children), plugins: [history()] }),
    nodeViews: {
      code_cell: createCodeCellView(opts.runnable === false ? undefined : (run as never)),
      output: createOutputView(async () => ({ renderMathSvg: () => "<svg></svg>" })),
    },
    dispatchTransaction(tr) {
      if (tr.docChanged) state.docChanges++;
      view.updateState(view.state.apply(tr));
    },
  });
  views.push(view);
  return {
    view,
    calls,
    state,
    previews: () => calls.filter((c) => c.preview),
    normals: () => calls.filter((c) => !c.preview),
    options: () => view.state.doc.firstChild!.attrs.options as string,
  };
}

const flush = async (): Promise<void> => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
const OK = { status: "ok", language: "python", durationMs: 1 } as const;

/** Simulates a normal run of the cell in the view: the run status marks the cell `is-running`, then clears it. */
async function finishNormalRun(view: EditorView): Promise<void> {
  const el = view.dom.querySelector(".qmd-cell")!;
  el.classList.add("is-running");
  await flush();
  el.classList.remove("is-running");
  el.classList.remove("is-run-requested");
  await flush();
}

const controlsOf = (view: EditorView) => Array.from(view.dom.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input[type="range"], input[type="checkbox"], select'));
const rangeOf = (view: EditorView) => view.dom.querySelector<HTMLInputElement>('input[type="range"]')!;

function drag(el: HTMLInputElement, value: number): void {
  el.value = String(value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function release(el: HTMLElement): void {
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function nameOf(el: Element): string {
  const aria = el.getAttribute("aria-label");
  if (aria) return aria;
  const by = el.getAttribute("aria-labelledby");
  if (by) return by.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ").trim();
  return Array.from((el as HTMLInputElement).labels ?? []).map((label) => label.textContent).join(" ").trim();
}

describe("4.1 param strip in the code cell view", () => {
  it("4.1a dragging produces no preview before the 150 ms debounce has passed and one after it", () => {
    const m = mountCell([cell(OPTIONS)]);
    drag(rangeOf(m.view), 6);
    jest.advanceTimersByTime(DEBOUNCE - 1);
    expect(m.calls).toHaveLength(0);
    jest.advanceTimersByTime(1);
    expect(m.calls).toHaveLength(1);
    expect(m.calls[0]).toMatchObject({ label: "sim", code: CODE, language: "python", params: { speed: 6 } });
    expect(m.calls[0]!.preview).toBeTruthy();
  });

  it("4.1a a burst of input events inside the debounce window yields one preview with the last value", () => {
    const m = mountCell([cell(OPTIONS)]);
    const range = rangeOf(m.view);
    drag(range, 1);
    jest.advanceTimersByTime(50);
    drag(range, 2);
    jest.advanceTimersByTime(50);
    drag(range, 3);
    jest.advanceTimersByTime(1000);
    expect(m.previews()).toHaveLength(1);
    expect(m.previews()[0]!.params).toEqual({ speed: 3 });
  });

  it("4.1a a preview carries every param of the cell, the dragged one changed", () => {
    const options = `${OPTIONS}#| param: mode = select("a", "b"; "a")\n#| param: on = checkbox(true)\n`;
    const m = mountCell([cell(options)]);
    drag(rangeOf(m.view), 8);
    jest.advanceTimersByTime(DEBOUNCE);
    expect(m.previews()[0]!.params).toEqual({ speed: 8, mode: "a", on: true });
  });

  it("4.1a values dragged while a preview is in flight start no second preview", () => {
    const m = mountCell([cell(OPTIONS)]);
    const range = rangeOf(m.view);
    drag(range, 6);
    jest.advanceTimersByTime(DEBOUNCE);
    expect(m.previews()).toHaveLength(1);
    drag(range, 7);
    jest.advanceTimersByTime(DEBOUNCE * 3);
    drag(range, 8);
    jest.advanceTimersByTime(DEBOUNCE * 3);
    expect(m.calls).toHaveLength(1);
  });

  it("4.1a dragging writes nothing to the note and starts no normal run", () => {
    const m = mountCell([cell(OPTIONS)]);
    const before = m.view.state.doc;
    const range = rangeOf(m.view);
    drag(range, 4);
    jest.advanceTimersByTime(50);
    drag(range, 9);
    jest.advanceTimersByTime(2000);
    expect(m.state.docChanges).toBe(0);
    expect(m.view.state.doc.eq(before)).toBe(true);
    expect(m.options()).toBe(OPTIONS);
    expect(m.normals()).toHaveLength(0);
  });

  it("4.1a a release while a preview is in flight does not start the normal run until the preview ends", () => {
    const m = mountCell([cell(OPTIONS)]);
    const range = rangeOf(m.view);
    drag(range, 6);
    jest.advanceTimersByTime(DEBOUNCE);
    expect(m.previews()).toHaveLength(1);
    drag(range, 7);
    release(range);
    jest.advanceTimersByTime(2000);
    expect(m.normals()).toHaveLength(0);
    expect(m.previews()).toHaveLength(1);
  });

  it("4.1b release rewrites only the value in the param line", () => {
    const options = "#| label: sim\n#| echo: false\n#| param: speed = slider( 0, 10 , 5 , step = 1 )\n#| param: mode = select(\"a\", \"b\"; \"a\")\n";
    const m = mountCell([cell(options)]);
    const range = rangeOf(m.view);
    drag(range, 7);
    release(range);
    expect(m.options()).toBe("#| label: sim\n#| echo: false\n#| param: speed = slider( 0, 10 , 7 , step = 1 )\n#| param: mode = select(\"a\", \"b\"; \"a\")\n");
    expect(m.view.state.doc.firstChild!.attrs.code).toBe(CODE);
  });

  it("4.1b release triggers one normal run with the params", () => {
    const m = mountCell([cell(OPTIONS)]);
    const range = rangeOf(m.view);
    drag(range, 7);
    release(range);
    jest.advanceTimersByTime(2000);
    expect(m.normals()).toHaveLength(1);
    expect(m.normals()[0]).toMatchObject({ label: "sim", code: CODE, language: "python", params: { speed: 7 } });
    expect(m.normals()[0]!.preview).toBeFalsy();
  });

  it("4.1b the param line is already rewritten when the normal run is requested", () => {
    const m = mountCell([cell(OPTIONS)]);
    const range = rangeOf(m.view);
    drag(range, 7);
    release(range);
    jest.advanceTimersByTime(2000);
    expect(m.normals()[0]!.optionsAtCall).toBe(`#| label: sim\n#| param: speed = slider(0, 10, 7, step = 1)\n`);
  });

  it("4.1b release writes the param line in one transaction that one undo takes back", () => {
    const m = mountCell([cell(OPTIONS)]);
    const range = rangeOf(m.view);
    drag(range, 3);
    jest.advanceTimersByTime(50);
    drag(range, 7);
    release(range);
    jest.advanceTimersByTime(2000);
    expect(m.state.docChanges).toBe(1);
    undo(m.view.state, m.view.dispatch);
    expect(m.options()).toBe(OPTIONS);
  });

  it("4.1b pointer up followed by change (the browser's order) gives one normal run", () => {
    const m = mountCell([cell(OPTIONS)]);
    const range = rangeOf(m.view);
    drag(range, 7);
    range.dispatchEvent(new Event("pointerup", { bubbles: true }));
    release(range);
    jest.advanceTimersByTime(2000);
    expect(m.normals()).toHaveLength(1);
    expect(m.options()).toContain("slider(0, 10, 7, step = 1)");
  });

  it("4.1b change followed by key up (a key step) gives one normal run", () => {
    const m = mountCell([cell(OPTIONS)]);
    const range = rangeOf(m.view);
    drag(range, 6);
    release(range);
    range.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowRight", bubbles: true }));
    jest.advanceTimersByTime(2000);
    expect(m.normals()).toHaveLength(1);
    expect(m.options()).toContain("slider(0, 10, 6, step = 1)");
  });

  it("4.1b a select writes its quoted choice and runs with it", () => {
    const options = `#| label: sim\n#| param: mode = select("a", "b"; "a")\n`;
    const m = mountCell([cell(options)]);
    const select = m.view.dom.querySelector<HTMLSelectElement>("select")!;
    select.value = "b";
    select.dispatchEvent(new Event("input", { bubbles: true }));
    release(select);
    jest.advanceTimersByTime(2000);
    expect(m.options()).toBe(`#| label: sim\n#| param: mode = select("a", "b"; "b")\n`);
    expect(m.normals()).toHaveLength(1);
    expect(m.normals()[0]!.params).toEqual({ mode: "b" });
  });

  it("4.1b a checkbox writes its boolean and runs with it", () => {
    const options = `#| label: sim\n#| param: on = checkbox(true)\n`;
    const m = mountCell([cell(options)]);
    const box = m.view.dom.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    box.checked = false;
    box.dispatchEvent(new Event("input", { bubbles: true }));
    release(box);
    jest.advanceTimersByTime(2000);
    expect(m.options()).toBe(`#| label: sim\n#| param: on = checkbox(false)\n`);
    expect(m.normals()).toHaveLength(1);
    expect(m.normals()[0]!.params).toEqual({ on: false });
  });

  it("4.1c draws one native control per param, each labelled by its name", () => {
    const options = `${OPTIONS}#| param: mode = select("a", "b"; "a")\n#| param: on = checkbox(true)\n`;
    const m = mountCell([cell(options)]);
    const controls = controlsOf(m.view);
    expect(controls).toHaveLength(3);
    expect(controls.map((el) => nameOf(el)).map((name) => /speed|mode|on/.exec(name)?.[0])).toEqual(["speed", "mode", "on"]);
  });

  it("4.1c shows the value as text beside the range and exposes it as aria-valuetext", () => {
    const m = mountCell([cell(OPTIONS)]);
    const range = rangeOf(m.view);
    expect(range.getAttribute("aria-valuetext")).toMatch(/5/);
    drag(range, 7);
    expect(range.getAttribute("aria-valuetext")).toMatch(/7/);
    expect(range.parentElement!.textContent).toMatch(/7/);
  });

  it("4.1c the range takes its bounds and step from the param line", () => {
    const m = mountCell([cell("#| label: sim\n#| param: speed = slider(2, 20, 6, step = 2)\n")]);
    const range = rangeOf(m.view);
    expect(Number(range.min)).toBe(2);
    expect(Number(range.max)).toBe(20);
    expect(Number(range.step)).toBe(2);
    expect(Number(range.value)).toBe(6);
  });

  it("4.1c a folded cell still shows its strip, between the hidden code and the output", async () => {
    const m = mountCell([cell(OPTIONS), await resultOutput()]);
    const panel = m.view.dom.querySelector<HTMLElement>(".qmd-cell-panel")!;
    expect(panel.hidden).toBe(true);
    const range = rangeOf(m.view);
    expect(range).not.toBeNull();
    expect(range.closest(".qmd-cell-panel")).toBeNull();
    for (let el: Element | null = range; el && el !== m.view.dom; el = el.parentElement) {
      expect((el as HTMLElement).hidden).toBe(false);
      expect((el as HTMLElement).style.display).not.toBe("none");
    }
    const output = m.view.dom.querySelector(".qmd-output")!;
    expect(range.compareDocumentPosition(output) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("4.1c a folded cell's strip still previews", async () => {
    const m = mountCell([cell(OPTIONS), await resultOutput()]);
    drag(rangeOf(m.view), 9);
    jest.advanceTimersByTime(DEBOUNCE);
    expect(m.previews()).toHaveLength(1);
    expect(m.previews()[0]!.params).toEqual({ speed: 9 });
  });

  it("4.1c the controls are natively focusable and enabled", () => {
    const m = mountCell([cell(OPTIONS)]);
    const range = rangeOf(m.view);
    expect(range.disabled).toBe(false);
    expect(range.tabIndex).toBeGreaterThanOrEqual(0);
    expect(range.type).toBe("range");
  });

  it("4.1c an arrow key on the range is left to the control, not taken by the editor", () => {
    const m = mountCell([cell(OPTIONS)]);
    const event = new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true });
    rangeOf(m.view).dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it("4.1c without a run callback the controls are disabled", () => {
    const m = mountCell([cell(OPTIONS)], { runnable: false });
    const controls = controlsOf(m.view);
    expect(controls).toHaveLength(1);
    expect(controls[0]!.disabled).toBe(true);
  });

  it("4.1c a cell without param lines draws no controls", () => {
    const m = mountCell([cell("#| label: sim\n")]);
    expect(controlsOf(m.view)).toHaveLength(0);
  });

  it("4.1c a malformed param line draws no control", () => {
    const m = mountCell([cell("#| label: sim\n#| param: speed = slider(0, 10\n")]);
    expect(controlsOf(m.view)).toHaveLength(0);
  });

  it("4.1a a value that arrives while a preview is in flight runs after it ends, the last value winning", () => {
    const m = mountCell([cell(OPTIONS)]);
    const range = rangeOf(m.view);
    drag(range, 6);
    jest.advanceTimersByTime(DEBOUNCE);
    drag(range, 7);
    jest.advanceTimersByTime(DEBOUNCE * 2);
    drag(range, 8);
    jest.advanceTimersByTime(DEBOUNCE * 2);
    expect(m.previews()).toHaveLength(1);
    m.previews()[0]!.preview!(undefined);
    jest.advanceTimersByTime(DEBOUNCE * 3);
    expect(m.previews()).toHaveLength(2);
    expect(m.previews()[1]!.params).toEqual({ speed: 8 });
  });

  it("4.1a after the last queued preview ends nothing more runs", () => {
    const m = mountCell([cell(OPTIONS)]);
    const range = rangeOf(m.view);
    drag(range, 6);
    jest.advanceTimersByTime(DEBOUNCE);
    drag(range, 8);
    jest.advanceTimersByTime(DEBOUNCE * 2);
    m.previews()[0]!.preview!({ ...OK, text: "six" });
    jest.advanceTimersByTime(DEBOUNCE * 2);
    expect(m.previews()).toHaveLength(2);
    m.previews()[1]!.preview!({ ...OK, text: "eight" });
    jest.advanceTimersByTime(DEBOUNCE * 5);
    expect(m.calls).toHaveLength(2);
    expect(m.state.docChanges).toBe(0);
  });

  it("4.1a a new drag after a preview ended starts a new preview", () => {
    const m = mountCell([cell(OPTIONS)]);
    const range = rangeOf(m.view);
    drag(range, 6);
    jest.advanceTimersByTime(DEBOUNCE);
    m.previews()[0]!.preview!(undefined);
    drag(range, 2);
    jest.advanceTimersByTime(DEBOUNCE);
    expect(m.previews()).toHaveLength(2);
    expect(m.previews()[1]!.params).toEqual({ speed: 2 });
  });

  it("4.1a the strip is aria-busy while a preview is in flight and not after it ends", () => {
    const m = mountCell([cell(OPTIONS)]);
    const range = rangeOf(m.view);
    expect(range.closest('[aria-busy="true"]')).toBeNull();
    drag(range, 6);
    jest.advanceTimersByTime(DEBOUNCE);
    expect(range.closest('[aria-busy="true"]')).not.toBeNull();
    m.previews()[0]!.preview!({ ...OK, text: "six" });
    expect(range.closest('[aria-busy="true"]')).toBeNull();
  });

  it("4.1a a preview result's text shows in place of the stored output", async () => {
    const m = mountCell([cell(OPTIONS), await resultOutput()]);
    drag(rangeOf(m.view), 6);
    jest.advanceTimersByTime(DEBOUNCE);
    m.previews()[0]!.preview!({ ...OK, text: "preview-text-6" });
    await flush();
    expect(m.view.dom.textContent).toContain("preview-text-6");
    expect(m.view.dom.textContent).not.toContain("result-text-42");
  });

  it("4.1a a log slider maps position 0..1000 to min * (max / min) ^ (position / 1000)", () => {
    const m = mountCell([cell("#| label: sim\n#| param: speed = slider(1, 1000, 10, log)\n")]);
    const range = rangeOf(m.view);
    expect(Number(range.min)).toBe(0);
    expect(Number(range.max)).toBe(1000);
    const previewAt = (position: number): number => {
      drag(range, position);
      jest.advanceTimersByTime(DEBOUNCE);
      const call = m.previews()[m.previews().length - 1]!;
      const value = (call.params as { speed: number }).speed;
      call.preview!(undefined);
      return value;
    };
    expect(previewAt(0)).toBeCloseTo(1, 3);
    expect(previewAt(500)).toBeCloseTo(Math.sqrt(1000), 3);
    expect(previewAt(1000)).toBeCloseTo(1000, 3);
  });

  it("4.1b a release that waited for a preview rewrites the line and runs once the preview ends", () => {
    const m = mountCell([cell(OPTIONS)]);
    const range = rangeOf(m.view);
    drag(range, 6);
    jest.advanceTimersByTime(DEBOUNCE);
    drag(range, 7);
    release(range);
    jest.advanceTimersByTime(1000);
    expect(m.normals()).toHaveLength(0);
    m.previews()[0]!.preview!(undefined);
    jest.advanceTimersByTime(1000);
    expect(m.normals()).toHaveLength(1);
    expect(m.normals()[0]!.params).toEqual({ speed: 7 });
    expect(m.options()).toBe("#| label: sim\n#| param: speed = slider(0, 10, 7, step = 1)\n");
    expect(m.state.docChanges).toBe(1);
  });
});

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
