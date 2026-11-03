/** @jest-environment jsdom */
/** Tests the Style panels of the data editor (plan charts, spec 4.3): a change reaches the reported model and the live preview figure, for every data type. */
import { emptyChart, type ChartModel, type ChartTable, type ChartTrace } from "../../../../src/qmd/chart/model";
import { mountDataEditor } from "../../../../src/qmd/dom/figureEditor/dataEditor";
import { askDialog } from "../../../../src/ui/dom/widgets/dialog";
import { closeMenu } from "../../../../src/ui/dom/widgets/menu";
import { fakePlotly, type Fake } from "../plotViewHarness";
import {
  activate, chooseOption, controls, fakeFrames, nameOf, settle, type Frames,
} from "../chartEditor/chartEditorHarness";

jest.mock("../../../../src/ui/dom/widgets/dialog", () => ({ ...jest.requireActual("../../../../src/ui/dom/widgets/dialog"), askDialog: jest.fn() }));
const ask = askDialog as jest.Mock;

const TABLE: ChartTable = {
  cols: [
    { name: "t", values: [1, 2, 3] },
    { name: "v", values: [10, 20, 30] },
    { name: "w", values: [5, 6, 7] },
  ],
};

let frames: Frames;

beforeEach(() => {
  frames = fakeFrames();
  ask.mockReset();
});

afterEach(() => {
  closeMenu();
  frames.restore();
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
