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
  activate, addTraceButton, allControls, cards, controls, fakeFrames, nameOf, press, setChoice, settle, shown, type Frames,
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
