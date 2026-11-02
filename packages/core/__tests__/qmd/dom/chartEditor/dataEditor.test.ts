/** @jest-environment jsdom */
/**
 * Tests the data editor layout (plan charts, spec 2.3, D9): the left nav (Structure > Traces; Style > General, Traces, Axes, Legend), "+ Trace",
 * trace cards with Type, X, Y and Z column controls, Transpose for grid types, a confirmed removal, and a live preview that redraws once per frame.
 * Plotly is a fake PlotlyApi behind the loader and animation frames are queued by hand; controls are found by accessible name.
 */
import { emptyChart, type ChartModel, type ChartTable, type ChartTrace } from "../../../../src/qmd/chart/model";
import { mountDataEditor } from "../../../../src/qmd/dom/chartEditor/dataEditor";
import { askDialog } from "../../../../src/ui/dom/widgets/dialog";
import { closeMenu } from "../../../../src/ui/dom/widgets/menu";
import { deferred, fakePlotly, type Fake } from "../plotViewHarness";
import {
  TRANSPOSE, TYPE, X_COL, Y_COL, Z_COL, REMOVE,
  activate, addTraceButton, allControls, cards, chooseOption, controls, fakeFrames, nameOf, press, setChoice, settle, shown, type Frames,
} from "./chartEditorHarness";

jest.mock("../../../../src/ui/dom/widgets/dialog", () => ({ ...jest.requireActual("../../../../src/ui/dom/widgets/dialog"), askDialog: jest.fn() }));
const ask = askDialog as jest.Mock;

const TABLE: ChartTable = {
  cols: [
    { name: "t", values: [1, 2, 3] },
    { name: "v", values: [10, 20, 30] },
    { name: "w", values: [5, 6, 7] },
  ],
};

function model(traces: ChartTrace[]): ChartModel {
  return { ...emptyChart("data", "a1b2c3d4"), data: TABLE, traces };
}

const LINE: ChartTrace = { type: "scatter", x: "A", y: "B", mode: "lines" };
const BARS: ChartTrace = { type: "bar", x: "A", y: "C" };
const SURFACE: ChartTrace = { type: "surface", z: ["B", "C"] };

interface Mounted {
  root: HTMLElement;
  fake: Fake;
  changes: ChartModel[];
  latest(): ChartModel;
  /** Runs an edit, then hands the model it reported back to the editor as a host would; settles the frames. */
  act(edit: () => void): Promise<void>;
  editor: ReturnType<typeof mountDataEditor>;
}

let frames: Frames;
let mounted: Mounted[] = [];

async function mount(traces: ChartTrace[]): Promise<Mounted> {
  const root = document.createElement("div");
  document.body.append(root);
  const fake = fakePlotly();
  const changes: ChartModel[] = [];
  const start = model(traces);
  const editor = mountDataEditor(root, { model: start, table: TABLE }, (m) => { changes.push(m); }, async () => fake.api);
  const m: Mounted = {
    root, fake, changes, editor,
    latest: () => changes[changes.length - 1] ?? start,
    async act(edit) {
      const before = changes.length;
      edit();
      await settle(frames);
      if (changes.length > before) editor.update(changes[changes.length - 1]!, TABLE);
      await settle(frames);
    },
  };
  mounted.push(m);
  await settle(frames);
  return m;
}

beforeEach(() => {
  frames = fakeFrames();
  ask.mockReset();
});

afterEach(() => {
  for (const m of mounted) { m.editor.destroy(); m.root.remove(); }
  mounted = [];
  closeMenu();
  frames.restore();
});

const lastFigure = (fake: Fake): { data: Record<string, unknown>[]; layout: Record<string, unknown> } => {
  const call = fake.react.mock.calls[fake.react.mock.calls.length - 1] as unknown[];
  return { data: call[1] as Record<string, unknown>[], layout: call[2] as Record<string, unknown> };
};

describe("2.3a the trace list and the live preview", () => {
  test("2.3a mounting draws the preview inside the root with the figure of the model", async () => {
    const m = await mount([LINE]);
    expect(m.fake.react).toHaveBeenCalled();
    const call = m.fake.react.mock.calls[0] as unknown[];
    expect(m.root.contains(call[0] as HTMLElement)).toBe(true);
    const { data } = lastFigure(m.fake);
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({ type: "scatter", x: [1, 2, 3], y: [10, 20, 30] });
  });

  test("2.3a each trace of the model has one card with a Type control", async () => {
    const m = await mount([LINE, BARS]);
    expect(cards(m.root)).toHaveLength(2);
  });

  test("2.3a the Type, X and Y controls show the trace's current values", async () => {
    const m = await mount([BARS]);
    const card = cards(m.root)[0]!;
    const type = controls(card, TYPE)[0] as HTMLSelectElement;
    const x = controls(card, X_COL)[0] as HTMLSelectElement;
    const y = controls(card, Y_COL)[0] as HTMLSelectElement;
    expect(type.value.toLowerCase()).toBe("bar");
    expect(x.value).toBe("A");
    expect(y.value).toBe("C");
  });

  test("2.3a the column selects list every column of the table by letter", async () => {
    const m = await mount([LINE]);
    const x = controls(cards(m.root)[0]!, X_COL)[0] as HTMLSelectElement;
    const texts = [...x.options].map((o) => o.text.trim());
    for (const letter of ["A", "B", "C"]) expect(texts.some((t) => t === letter || t.startsWith(`${letter} `) || t.startsWith(`${letter} `) || t.startsWith(`${letter} —`))).toBe(true);
  });

  test("2.3a + Trace adds a card and reports a model with one more trace", async () => {
    const m = await mount([LINE]);
    const add = addTraceButton(m.root);
    expect(add).toBeDefined();
    await m.act(() => add!.click());
    expect(m.changes).toHaveLength(1);
    expect(m.latest().traces).toHaveLength(2);
    expect(m.latest().traces[0]).toEqual(LINE);
    expect(cards(m.root)).toHaveLength(2);
  });

  test("2.3a + Trace redraws the preview once with the new trace in the figure", async () => {
    const m = await mount([LINE]);
    m.fake.react.mockClear();
    await m.act(() => addTraceButton(m.root)!.click());
    expect(m.fake.react).toHaveBeenCalledTimes(1);
    expect(lastFigure(m.fake).data).toHaveLength(2);
  });

  test("2.3a changing Type changes the model's trace type", async () => {
    const m = await mount([LINE]);
    await m.act(() => setChoice(controls(cards(m.root)[0]!, TYPE)[0]!, "bar"));
    expect(m.latest().traces[0]!.type).toBe("bar");
    expect(m.latest().traces).toHaveLength(1);
  });

  test("2.3a changing Type redraws the preview once with the new figure", async () => {
    const m = await mount([LINE]);
    m.fake.react.mockClear();
    await m.act(() => setChoice(controls(cards(m.root)[0]!, TYPE)[0]!, "bar"));
    expect(m.fake.react).toHaveBeenCalledTimes(1);
    expect(lastFigure(m.fake).data[0]).toMatchObject({ type: "bar" });
  });

  test("2.3a changing X changes the model's x column", async () => {
    const m = await mount([LINE]);
    await m.act(() => setChoice(controls(cards(m.root)[0]!, X_COL)[0]!, "C"));
    expect(m.latest().traces[0]!.x).toBe("C");
    expect(m.latest().traces[0]!.y).toBe("B");
  });

  test("2.3a changing X redraws the preview once with that column's values", async () => {
    const m = await mount([LINE]);
    m.fake.react.mockClear();
    await m.act(() => setChoice(controls(cards(m.root)[0]!, X_COL)[0]!, "C"));
    expect(m.fake.react).toHaveBeenCalledTimes(1);
    expect(lastFigure(m.fake).data[0]).toMatchObject({ x: [5, 6, 7], y: [10, 20, 30] });
  });

  test("2.3a changing Y changes the model's y column and redraws once", async () => {
    const m = await mount([LINE]);
    m.fake.react.mockClear();
    await m.act(() => setChoice(controls(cards(m.root)[0]!, Y_COL)[0]!, "C"));
    expect(m.latest().traces[0]!.y).toBe("C");
    expect(m.fake.react).toHaveBeenCalledTimes(1);
    expect(lastFigure(m.fake).data[0]).toMatchObject({ x: [1, 2, 3], y: [5, 6, 7] });
  });

  test("2.3a editing the second trace leaves the first trace as it was", async () => {
    const m = await mount([LINE, BARS]);
    await m.act(() => setChoice(controls(cards(m.root)[1]!, Y_COL)[0]!, "B"));
    expect(m.latest().traces[0]).toEqual(LINE);
    expect(m.latest().traces[1]).toMatchObject({ type: "bar", y: "B" });
  });

  test("2.3a update with a new model redraws the preview once with its figure", async () => {
    const m = await mount([LINE]);
    m.fake.react.mockClear();
    m.editor.update(model([BARS, LINE]), TABLE);
    await settle(frames);
    expect(m.fake.react).toHaveBeenCalledTimes(1);
    expect(lastFigure(m.fake).data.map((d) => d.type)).toEqual(["bar", "scatter"]);
    expect(cards(m.root)).toHaveLength(2);
  });

  test("2.3a destroy purges the preview", async () => {
    const m = await mount([LINE]);
    m.editor.destroy();
    expect(m.fake.purge).toHaveBeenCalled();
    m.fake.react.mockClear();
    await settle(frames);
    expect(m.fake.react).not.toHaveBeenCalled();
  });
});

describe("2.3b surface traces and removal", () => {
  test("2.3b a surface trace offers Transpose and a scatter trace does not", async () => {
    const m = await mount([LINE, SURFACE]);
    const [scatterCard, surfaceCard] = cards(m.root);
    expect(controls(scatterCard!, TRANSPOSE)).toHaveLength(0);
    expect(controls(surfaceCard!, TRANSPOSE)).toHaveLength(1);
  });

  test("2.3b a surface trace offers Z as several columns of the table", async () => {
    const m = await mount([SURFACE]);
    const z = controls(cards(m.root)[0]!, Z_COL);
    expect(z.length).toBeGreaterThan(0);
    const first = z[0]!;
    if (first instanceof HTMLSelectElement) {
      expect(first.multiple).toBe(true);
      expect(first.options.length).toBe(TABLE.cols.length);
      expect([...first.selectedOptions].map((o) => o.value)).toEqual(["B", "C"]);
    } else {
      expect(z.length).toBe(TABLE.cols.length);
    }
  });

  test("2.3b a scatter trace offers no Z control", async () => {
    const m = await mount([LINE]);
    expect(controls(cards(m.root)[0]!, Z_COL)).toHaveLength(0);
  });

  test("2.3b choosing Z columns writes them to the trace in order", async () => {
    const m = await mount([{ type: "surface" }]);
    const z = controls(cards(m.root)[0]!, Z_COL);
    await m.act(() => {
      const first = z[0]!;
      if (first instanceof HTMLSelectElement) {
        for (const o of first.options) o.selected = o.value === "B" || o.value === "C";
        first.dispatchEvent(new Event("input", { bubbles: true }));
        first.dispatchEvent(new Event("change", { bubbles: true }));
      } else {
        for (const box of z) if (/(^|[^A-Za-z])(B|C)([^A-Za-z]|$)/.test(nameOf(box))) box.click();
      }
    });
    expect(m.latest().traces[0]!.z).toEqual(["B", "C"]);
  });

  test("2.3b Transpose toggles the trace's transpose flag", async () => {
    const m = await mount([SURFACE]);
    await m.act(() => controls(cards(m.root)[0]!, TRANSPOSE)[0]!.click());
    expect(m.latest().traces[0]!.transpose).toBe(true);
    await m.act(() => controls(cards(m.root)[0]!, TRANSPOSE)[0]!.click());
    expect(m.latest().traces[0]!.transpose).not.toBe(true);
  });

  test("2.3b changing a scatter trace to surface offers Z and Transpose", async () => {
    const m = await mount([LINE]);
    await m.act(() => setChoice(controls(cards(m.root)[0]!, TYPE)[0]!, "surface"));
    expect(m.latest().traces[0]!.type).toBe("surface");
    const card = cards(m.root)[0]!;
    expect(controls(card, Z_COL).length).toBeGreaterThan(0);
    expect(controls(card, TRANSPOSE)).toHaveLength(1);
  });

  test("2.3b heatmap and contour traces offer Transpose", async () => {
    const m = await mount([{ type: "heatmap", z: ["B"] }, { type: "contour", z: ["B"] }]);
    for (const card of cards(m.root)) expect(controls(card, TRANSPOSE)).toHaveLength(1);
  });

  test("2.3b removing a trace asks before changing anything", async () => {
    const answer = deferred<boolean>();
    ask.mockReturnValue(answer.promise);
    const m = await mount([LINE, BARS]);
    controls(cards(m.root)[0]!, REMOVE)[0]!.click();
    await settle(frames);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(m.changes).toHaveLength(0);
    expect(cards(m.root)).toHaveLength(2);
    answer.resolve(true);
    await settle(frames);
    expect(m.changes).toHaveLength(1);
  });

  test("2.3b confirming the removal drops that trace from the model and the cards", async () => {
    ask.mockResolvedValue(true);
    const m = await mount([LINE, BARS]);
    await m.act(() => controls(cards(m.root)[0]!, REMOVE)[0]!.click());
    expect(m.latest().traces).toEqual([BARS]);
    expect(cards(m.root)).toHaveLength(1);
  });

  test("2.3b declining the removal keeps the trace and reports no change", async () => {
    ask.mockResolvedValue(false);
    const m = await mount([LINE, BARS]);
    await m.act(() => controls(cards(m.root)[0]!, REMOVE)[0]!.click());
    expect(ask).toHaveBeenCalledTimes(1);
    expect(m.changes).toHaveLength(0);
    expect(cards(m.root)).toHaveLength(2);
  });

  test("2.3b every trace card has its own remove control", async () => {
    const m = await mount([LINE, BARS, SURFACE]);
    for (const card of cards(m.root)) expect(controls(card, REMOVE)).toHaveLength(1);
  });
});

describe("2.3c nav, keyboard and labels", () => {
  /** The nav entries in order: Traces, General, Traces, Axes, Legend. */
  function navItems(root: HTMLElement): HTMLElement[] {
    const list = [...root.querySelectorAll<HTMLElement>('[role="tab"], nav button, nav a, [role="tablist"] button, [role="navigation"] button')];
    const start = list.findIndex((el) => /^general$/i.test(nameOf(el)));
    return start < 1 ? list : list.slice(start - 1, start + 4);
  }

  const mountPlain = (): Promise<Mounted> => mount([LINE]);

  test("2.3c the nav lists Traces under Structure and General, Traces, Axes, Legend under Style", async () => {
    const m = await mountPlain();
    const names = navItems(m.root).map((el) => nameOf(el).toLowerCase());
    expect(names).toHaveLength(5);
    expect(names[0]).toContain("traces");
    expect(names[1]).toContain("general");
    expect(names[2]).toContain("traces");
    expect(names[3]).toContain("axes");
    expect(names[4]).toContain("legend");
  });

  test("2.3c the nav names its groups Structure and Style", async () => {
    const m = await mountPlain();
    const text = m.root.textContent ?? "";
    expect(text).toMatch(/Structure/);
    expect(text).toMatch(/Style/);
  });

  test("2.3c the Traces panel is shown first, with the trace cards and + Trace", async () => {
    const m = await mountPlain();
    expect(addTraceButton(m.root)).toBeDefined();
    expect(cards(m.root)).toHaveLength(1);
  });

  test("2.3c the keyboard moves focus from Traces to the next nav entry", async () => {
    const m = await mountPlain();
    const items = navItems(m.root);
    items[0]!.focus();
    expect(document.activeElement).toBe(items[0]);
    for (const key of ["ArrowDown", "ArrowRight"]) {
      press(document.activeElement!, key);
      if (document.activeElement !== items[0]) break;
    }
    expect(document.activeElement).toBe(items[1]);
  });

  test("2.3c the keyboard moves focus back with the opposite arrow", async () => {
    const m = await mountPlain();
    const items = navItems(m.root);
    items[1]!.focus();
    for (const key of ["ArrowUp", "ArrowLeft"]) {
      press(document.activeElement!, key);
      if (document.activeElement !== items[1]) break;
    }
    expect(document.activeElement).toBe(items[0]);
  });

  test("2.3c activating a Style entry with the keyboard shows its panel in place of the trace cards", async () => {
    const m = await mountPlain();
    const items = navItems(m.root);
    items[1]!.focus();
    activate(items[1]!);
    expect(addTraceButton(m.root)).toBeUndefined();
    expect(cards(m.root)).toHaveLength(0);
  });

  test("2.3c each Style entry shows a panel that names its settings", async () => {
    const m = await mountPlain();
    const items = navItems(m.root);
    for (const [i, word] of [[1, "general"], [3, "axes"], [4, "legend"]] as const) {
      items[i]!.focus();
      activate(items[i]!);
      const panel = m.root.querySelector<HTMLElement>('[role="tabpanel"]');
      const scope = panel !== null && shown(panel) ? panel : m.root;
      expect((scope.textContent ?? "").toLowerCase()).toContain(word);
    }
  });

  test("2.3c going back to Traces with the keyboard shows the cards again", async () => {
    const m = await mountPlain();
    const items = navItems(m.root);
    activate(items[1]!);
    expect(cards(m.root)).toHaveLength(0);
    items[0]!.focus();
    activate(items[0]!);
    expect(cards(m.root)).toHaveLength(1);
    expect(addTraceButton(m.root)).toBeDefined();
  });

  test("2.3c the Style entry named Traces opens a Style panel, not the trace cards", async () => {
    const m = await mountPlain();
    const items = navItems(m.root);
    items[2]!.focus();
    activate(items[2]!);
    expect(cards(m.root)).toHaveLength(0);
  });

  test("2.3c every control in the Traces panel has an accessible name", async () => {
    const m = await mount([LINE, BARS, SURFACE]);
    const unnamed = allControls(m.root).filter((el) => nameOf(el) === "");
    expect(unnamed.map((el) => el.outerHTML)).toEqual([]);
  });

  test("2.3c every control in each Style panel has an accessible name", async () => {
    const m = await mount([LINE]);
    const items = navItems(m.root);
    for (const i of [1, 2, 3, 4]) {
      activate(items[i]!);
      const unnamed = allControls(m.root).filter((el) => nameOf(el) === "");
      expect(unnamed.map((el) => el.outerHTML)).toEqual([]);
    }
  });

  test("2.3c the Type, X and Y controls of different traces are distinguishable by name", async () => {
    const m = await mount([LINE, BARS]);
    const typeNames = controls(m.root, TYPE).map(nameOf);
    expect(new Set(typeNames).size).toBe(2);
  });
});

// Spec 4.3: a change in a Style panel reaches the model the editor reports and the figure the live preview draws, for every data type.
// Plotly is a fake PlotlyApi behind the loader; animation frames are queued by hand; controls are found by accessible name.
describe("4.3 Style panels in the data editor", () => {
  type Anything = Record<string, unknown>;

  const TYPES: readonly { name: string; trace: ChartTrace }[] = [
    { name: "line", trace: { type: "scatter", x: "A", y: "B", mode: "lines" } },
    { name: "scatter", trace: { type: "scatter", x: "A", y: "B", mode: "markers" } },
    { name: "area", trace: { type: "scatter", x: "A", y: "B", fill: "tozeroy" } },
    { name: "bar", trace: { type: "bar", x: "A", y: "B" } },
    { name: "pie", trace: { type: "pie", x: "A", y: "B" } },
    { name: "heatmap", trace: { type: "heatmap", z: ["B", "C"] } },
    { name: "contour", trace: { type: "contour", z: ["B", "C"] } },
    { name: "surface", trace: { type: "surface", z: ["B", "C"] } },
    { name: "scatter3d", trace: { type: "scatter3d", x: "A", y: "B", z: ["C"] } },
    { name: "mesh3d", trace: { type: "mesh3d", x: "A", y: "B", z: ["C"] } },
    { name: "histogram", trace: { type: "histogram", x: "B" } },
    { name: "box", trace: { type: "box", y: "B" } },
  ];

  /** Types whose Plotly trace carries the trace's own colour (marker.color, or color for mesh3d). */
  const COLOURED = ["line", "scatter", "area", "bar", "histogram", "box", "scatter3d", "mesh3d"];
  /** Types that draw a colour scale. */
  const SCALED = ["heatmap", "contour", "surface"];

  function model(traces: ChartTrace[], layout: Anything = {}): ChartModel {
    const base = emptyChart("data", "a1b2c3d4");
    return { ...base, data: TABLE, traces, layout: { ...base.layout, ...layout } } as ChartModel;
  }

  interface Mounted {
    root: HTMLElement;
    fake: Fake;
    changes: ChartModel[];
    latest(): ChartModel;
    act(edit: () => void): Promise<void>;
    editor: ReturnType<typeof mountDataEditor>;
  }

  let frames: Frames;
  let mounted: Mounted[] = [];

  async function mount(traces: ChartTrace[], layout: Anything = {}): Promise<Mounted> {
    const root = document.createElement("div");
    document.body.append(root);
    const fake = fakePlotly();
    const changes: ChartModel[] = [];
    const start = model(traces, layout);
    const editor = mountDataEditor(root, { model: start, table: TABLE }, (m) => { changes.push(m); }, async () => fake.api);
    const m: Mounted = {
      root, fake, changes, editor,
      latest: () => changes[changes.length - 1] ?? start,
      async act(edit) {
        const before = changes.length;
        edit();
        await settle(frames);
        if (changes.length > before) editor.update(changes[changes.length - 1]!, TABLE);
        await settle(frames);
      },
    };
    mounted.push(m);
    await settle(frames);
    return m;
  }

  beforeEach(() => { frames = fakeFrames(); });

  afterEach(() => {
    for (const m of mounted) { m.editor.destroy(); m.root.remove(); }
    mounted = [];
    closeMenu();
    frames.restore();
  });

  const lastFigure = (fake: Fake): { data: Anything[]; layout: Anything } => {
    const call = fake.react.mock.calls[fake.react.mock.calls.length - 1] as unknown[];
    return { data: call[1] as Anything[], layout: call[2] as Anything };
  };

  const lay = (m: ChartModel): Anything => m.layout as unknown as Anything;
  const axis = (m: ChartModel, key: "xaxis" | "yaxis" | "zaxis"): Anything => lay(m)[key] as Anything;

  /** Opens a Style panel from the nav; the Style entry named Traces is the second tab with that name. */
  function open(m: Mounted, which: "general" | "traces" | "axes" | "legend"): void {
    const tabs = [...m.root.querySelectorAll<HTMLElement>('[role="tab"]')];
    const matching = tabs.filter((t) => nameOf(t).toLowerCase() === which);
    const tab = which === "traces" ? matching[matching.length - 1] : matching[0];
    if (tab === undefined) throw new Error(`no nav entry ${which}`);
    tab.focus();
    activate(tab);
  }

  function inputsNamed(scope: ParentNode, name: RegExp): HTMLInputElement[] {
    return controls(scope, name).filter((el): el is HTMLInputElement => el instanceof HTMLInputElement);
  }

  function input(m: Mounted, name: RegExp, nth = 0): HTMLInputElement {
    const found = inputsNamed(m.root, name)[nth];
    if (found === undefined) throw new Error(`no input #${nth} named ${String(name)}`);
    return found;
  }

  function commit(el: HTMLInputElement, value: string): void {
    el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function choose(m: Mounted, group: RegExp, want: string, option: RegExp, nth = 0): void {
    const select = controls(m.root, group).filter((el): el is HTMLSelectElement => el instanceof HTMLSelectElement)[nth];
    if (select !== undefined) { chooseOption(select, want); return; }
    const button = controls(m.root, option).filter((el) => el.tagName === "BUTTON")[nth];
    if (button === undefined) throw new Error(`no choice ${String(group)} / ${String(option)} #${nth}`);
    button.click();
  }

  function hexInput(m: Mounted): HTMLInputElement {
    const find = (root: ParentNode): HTMLInputElement | undefined => inputsNamed(root, /hex|colou?r/i).find((el) => el.type === "text");
    const direct = find(m.root);
    if (direct !== undefined) return direct;
    const panel = m.root.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])') ?? m.root;
    controls(panel, /colou?r/i).find((el) => el.tagName === "BUTTON")?.click();
    const opened = find(document);
    if (opened === undefined) throw new Error("no hex field for the colour control");
    return opened;
  }

  function legendToggle(m: Mounted): HTMLElement {
    const found = controls(m.root, /show|visible/i).find((el) => (el instanceof HTMLInputElement && el.type === "checkbox") || el.getAttribute("role") === "switch" || el.hasAttribute("aria-pressed"));
    if (found === undefined) throw new Error("no legend show toggle");
    return found;
  }

  describe("4.3a log axis and manual range", () => {
    test("4.3a setting the x axis to log changes the model and the preview figure", async () => {
      const m = await mount([TYPES[0]!.trace]);
      open(m, "axes");
      await m.act(() => choose(m, /type|scale/i, "log", /^log$/i, 0));
      expect(axis(m.latest(), "xaxis").type).toBe("log");
      expect(axis(m.latest(), "yaxis").type).toBe("linear");
      expect((lastFigure(m.fake).layout.xaxis as Anything).type).toBe("log");
      expect((lastFigure(m.fake).layout.yaxis as Anything).type).toBe("linear");
    });

    test("4.3a a manual x range changes the model and the preview figure", async () => {
      const m = await mount([TYPES[0]!.trace]);
      open(m, "axes");
      await m.act(() => {
        controls(m.root, /^manual$/i)[0]!.click();
        commit(input(m, /\bmin/i, 0), "0");
        commit(input(m, /\bmax/i, 0), "10");
      });
      expect(axis(m.latest(), "xaxis").range).toEqual([0, 10]);
      expect((lastFigure(m.fake).layout.xaxis as Anything).range).toEqual([0, 10]);
    });

    test("4.3a the x axis log with a manual range reaches the model and the figure together", async () => {
      const m = await mount([TYPES[0]!.trace]);
      open(m, "axes");
      await m.act(() => choose(m, /type|scale/i, "log", /^log$/i, 0));
      await m.act(() => {
        controls(m.root, /^manual$/i)[0]!.click();
        commit(input(m, /\bmin/i, 0), "1");
        commit(input(m, /\bmax/i, 0), "100");
      });
      expect(axis(m.latest(), "xaxis")).toMatchObject({ type: "log", range: [1, 100] });
      const figureX = lastFigure(m.fake).layout.xaxis as Anything;
      expect(figureX.type).toBe("log");
      expect(Array.isArray(figureX.range)).toBe(true);
      expect((figureX.range as number[]).length).toBe(2);
    });

    test("4.3a choosing Auto after a manual range removes it from the model and the figure", async () => {
      const m = await mount([TYPES[0]!.trace], { xaxis: { type: "linear", range: [0, 10] } });
      open(m, "axes");
      await m.act(() => controls(m.root, /^auto$/i)[0]!.click());
      expect("range" in axis(m.latest(), "xaxis")).toBe(false);
      expect((lastFigure(m.fake).layout.xaxis as Anything).range).toBeUndefined();
    });

    test("4.3a a Style change redraws the preview once", async () => {
      const m = await mount([TYPES[0]!.trace]);
      open(m, "axes");
      m.fake.react.mockClear();
      await m.act(() => choose(m, /type|scale/i, "log", /^log$/i, 0));
      expect(m.fake.react).toHaveBeenCalledTimes(1);
      expect(m.changes).toHaveLength(1);
    });

    test("4.3a opening a Style panel changes nothing", async () => {
      const m = await mount([TYPES[0]!.trace]);
      for (const which of ["general", "traces", "axes", "legend"] as const) {
        open(m, which);
        expect(m.root.querySelector('[role="tabpanel"]:not([hidden]) input, [role="tabpanel"]:not([hidden]) select')).not.toBeNull();
      }
      await settle(frames);
      expect(m.changes).toHaveLength(0);
    });

    test("4.3a an axis title reaches the figure", async () => {
      const m = await mount([TYPES[0]!.trace]);
      open(m, "axes");
      await m.act(() => commit(input(m, /title/i, 1), "Signal"));
      expect(axis(m.latest(), "yaxis").title).toBe("Signal");
      expect(JSON.stringify((lastFigure(m.fake).layout.yaxis as Anything).title)).toContain("Signal");
    });
  });

  describe("4.3b trace colour, opacity and legend", () => {
    test("4.3b a trace's colour changes through the Traces panel in the model and the figure", async () => {
      const m = await mount([TYPES[0]!.trace]);
      open(m, "traces");
      await m.act(() => commit(hexInput(m), "#336699"));
      expect(m.latest().traces[0]!.color).toBe("#336699");
      expect(JSON.stringify(lastFigure(m.fake).data[0])).toContain("#336699");
    });

    test("4.3b a trace's opacity changes through the Traces panel in the model and the figure", async () => {
      const m = await mount([TYPES[0]!.trace]);
      open(m, "traces");
      await m.act(() => commit(input(m, /opacity/i), "0.5"));
      expect(m.latest().traces[0]!.opacity).toBe(0.5);
      expect(lastFigure(m.fake).data[0]!.opacity).toBe(0.5);
    });

    test("4.3b a change to the second trace leaves the first trace's figure as it was", async () => {
      const m = await mount([TYPES[0]!.trace, TYPES[3]!.trace]);
      open(m, "traces");
      await m.act(() => commit(input(m, /opacity/i, 1), "0.25"));
      const { data } = lastFigure(m.fake);
      expect(data[0]!.opacity).toBeUndefined();
      expect(data[1]!.opacity).toBe(0.25);
    });

    test("4.3b hiding the legend works in the model and the figure", async () => {
      const m = await mount([TYPES[0]!.trace]);
      open(m, "legend");
      await m.act(() => legendToggle(m).click());
      expect((lay(m.latest()).legend as Anything).show).toBe(false);
      expect(lastFigure(m.fake).layout.showlegend).toBe(false);
    });

    test("4.3b showing the legend again works in the model and the figure", async () => {
      const m = await mount([TYPES[0]!.trace], { legend: { show: false } });
      open(m, "legend");
      await m.act(() => legendToggle(m).click());
      expect((lay(m.latest()).legend as Anything).show).toBe(true);
      expect(lastFigure(m.fake).layout.showlegend).not.toBe(false);
    });

    test("4.3b the legend orientation reaches the figure", async () => {
      const m = await mount([TYPES[0]!.trace]);
      open(m, "legend");
      await m.act(() => choose(m, /orientation/i, "h", /^horizontal$/i));
      expect((lastFigure(m.fake).layout.legend as Anything).orientation).toBe("h");
    });
  });

  describe("A6 every data type with the Style panels", () => {
    test.each(TYPES.map((t): [string, ChartTrace] => [t.name, t.trace]))("A6 %s: the opacity set in the Traces panel reaches the figure", async (_name, trace) => {
      const m = await mount([trace]);
      open(m, "traces");
      await m.act(() => commit(input(m, /opacity/i), "0.4"));
      expect(m.latest().traces[0]!.opacity).toBe(0.4);
      expect(lastFigure(m.fake).data[0]!.opacity).toBe(0.4);
    });

    test.each(TYPES.filter((t) => COLOURED.includes(t.name)).map((t): [string, ChartTrace] => [t.name, t.trace]))("A6 %s: the colour set in the Traces panel reaches the figure", async (_name, trace) => {
      const m = await mount([trace]);
      open(m, "traces");
      await m.act(() => commit(hexInput(m), "#123456"));
      expect(m.latest().traces[0]!.color).toBe("#123456");
      expect(JSON.stringify(lastFigure(m.fake).data[0])).toContain("#123456");
    });

    test.each(TYPES.map((t): [string, ChartTrace] => [t.name, t.trace]))("A6 %s: the title and font size set in General reach the figure", async (_name, trace) => {
      const m = await mount([trace]);
      open(m, "general");
      await m.act(() => commit(input(m, /title/i), "My chart"));
      await m.act(() => commit(input(m, /font size/i), "18"));
      expect(m.latest().title).toBe("My chart");
      expect(lay(m.latest()).fontSize).toBe(18);
      const { layout } = lastFigure(m.fake);
      expect(JSON.stringify(layout.title)).toContain("My chart");
      expect((layout.font as Anything).size).toBe(18);
    });

    test.each(TYPES.filter((t) => SCALED.includes(t.name)).map((t): [string, ChartTrace] => [t.name, t.trace]))("A6 %s: the default colour scale set in General reaches the figure", async (_name, trace) => {
      const m = await mount([trace]);
      open(m, "general");
      await m.act(() => choose(m, /colou?r ?scale/i, "Blues", /^blues$/i));
      expect(lay(m.latest()).colorscale).toBe("Blues");
      expect(lastFigure(m.fake).data[0]!.colorscale).toBe("Blues");
    });

    test("A6 bar: the bar mode set in General reaches the figure", async () => {
      const m = await mount([TYPES[3]!.trace, { type: "bar", x: "A", y: "C" }]);
      open(m, "general");
      await m.act(() => choose(m, /bar ?mode|barmode/i, "stack", /^stack/i));
      expect(lay(m.latest()).barmode).toBe("stack");
      expect(lastFigure(m.fake).layout.barmode).toBe("stack");
    });

    test("A6 line: the mode, line width and marker size set in the Traces panel reach the figure", async () => {
      const m = await mount([TYPES[0]!.trace]);
      open(m, "traces");
      await m.act(() => choose(m, /mode/i, "lines+markers", /^lines ?\+ ?markers$/i));
      await m.act(() => commit(input(m, /line width/i), "4"));
      await m.act(() => commit(input(m, /marker size/i), "9"));
      expect(m.latest().traces[0]).toMatchObject({ mode: "lines+markers", lineWidth: 4, markerSize: 9 });
      expect(lastFigure(m.fake).data[0]).toMatchObject({ mode: "lines+markers", line: { width: 4 }, marker: { size: 9 } });
    });

    test("A6 area: the fill set in the Traces panel reaches the figure", async () => {
      const m = await mount([{ type: "scatter", x: "A", y: "B", mode: "lines" }]);
      open(m, "traces");
      await m.act(() => choose(m, /fill/i, "tozeroy", /^fill/i));
      expect(m.latest().traces[0]!.fill).toBe("tozeroy");
      expect(lastFigure(m.fake).data[0]!.fill).toBe("tozeroy");
    });

    test("A6 surface: the Axes panel offers a z axis whose title reaches the 3D scene", async () => {
      const m = await mount([TYPES[7]!.trace], { zaxis: { type: "linear" } });
      open(m, "axes");
      expect(inputsNamed(m.root, /title/i)).toHaveLength(3);
      await m.act(() => commit(input(m, /title/i, 2), "Depth"));
      expect(axis(m.latest(), "zaxis").title).toBe("Depth");
      const scene = lastFigure(m.fake).layout.scene as { zaxis: Anything };
      expect(JSON.stringify(scene.zaxis.title)).toContain("Depth");
    });

    test.each<[string, ChartTrace]>([["surface", TYPES[7]!.trace], ["scatter3d", TYPES[8]!.trace], ["mesh3d", TYPES[9]!.trace]])("A6 %s: a log z axis reaches the 3D scene", async (_name, trace) => {
      const m = await mount([trace], { zaxis: { type: "linear" } });
      open(m, "axes");
      await m.act(() => choose(m, /type|scale/i, "log", /^log$/i, 2));
      expect(axis(m.latest(), "zaxis").type).toBe("log");
      expect(((lastFigure(m.fake).layout.scene as Anything).zaxis as Anything).type).toBe("log");
    });

    test("A6 an edit in one Style panel keeps the settings made in another", async () => {
      const m = await mount([TYPES[0]!.trace]);
      open(m, "general");
      await m.act(() => commit(input(m, /font size/i), "16"));
      open(m, "legend");
      await m.act(() => legendToggle(m).click());
      expect(lay(m.latest()).fontSize).toBe(16);
      expect((lay(m.latest()).legend as Anything).show).toBe(false);
      expect((lastFigure(m.fake).layout.font as Anything).size).toBe(16);
      expect(lastFigure(m.fake).layout.showlegend).toBe(false);
    });
  });

  describe("A6 controls have accessible names", () => {
    test("A6 every control in each Style panel has an accessible name and a visible label", async () => {
      const m = await mount([TYPES[0]!.trace, TYPES[7]!.trace], { zaxis: { type: "linear" } });
      for (const which of ["general", "traces", "axes", "legend"] as const) {
        open(m, which);
        const panel = m.root.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])') ?? m.root;
        const fields = [...panel.querySelectorAll<HTMLElement>("button, select, input, textarea")].filter((el) => el.closest("[hidden]") === null);
        expect(fields.length).toBeGreaterThan(0);
        expect(fields.filter((el) => nameOf(el) === "").map((el) => el.outerHTML)).toEqual([]);
      }
    });
  });
});
