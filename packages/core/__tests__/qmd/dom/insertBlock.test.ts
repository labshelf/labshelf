/** @jest-environment jsdom */
/**
 * Tests chart insertion (plan charts, D9, D10, spec 2.2): QMD_ACTIONS.chart with Mod-Alt-g, 'Chart' right after 'Diagram' in the Insert
 * panel, the gap menu and the empty-note choices, the empty chart node opening the editor on a null model, Cancel removing that
 * empty node in the same undo step, and open / Cancel / Apply / Ok on stored and freshly picked charts. Plotly is a fake.
 */
import { EditorState, NodeSelection, TextSelection, type Command, type Plugin } from "prosemirror-state";
import { history, undo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { EditorView } from "prosemirror-view";
import type { Node as PmNode } from "prosemirror-model";
import { qmdSchema as s } from "../../../src/qmd/editor/qmdSchema";
import { editRequestPlugin, qmdKeymap, QMD_ACTIONS } from "../../../src/qmd/dom/qmdCommands";
import { mountQmdEditor, type QmdEditorHandle } from "../../../src/qmd/dom/qmdEditor";
import { formatChartBlock, readChartBlock } from "../../../src/qmd/chart/block";
import type { ChartModel } from "../../../src/qmd/chart/model";
import { insertChartCommand } from "../../../src/qmd/dom/insertBlock";
import { loadChartEditor } from "../../../src/qmd/dom/chartEditor/index";
import type { ChartEditorHost } from "../../../src/qmd/dom/chartEditor/openChartEditor";
import { createChartView } from "../../../src/qmd/dom/chartView";
import type { PlotlyApi } from "../../../src/qmd/dom/plotView";
import { blockChoiceItems, insertPanel } from "../../../src/qmd/dom/qmdControls";
import { closeMenu } from "../../../src/ui/dom/widgets/menu";
import { renderIcon } from "../../../src/ui/icons/index";
import { fakePlotly } from "./plotViewHarness";
import { para, text, until } from "../../support/nodeViewHarness";

interface ChartAction { id: string; label: string; shortcut: string; icon: Parameters<typeof renderIcon>[0]; command: Command }
/** QMD_ACTIONS.chart, read without a static type so the file compiles before and after the action exists. */
const chartAction = (): ChartAction => (QMD_ACTIONS as unknown as Record<string, ChartAction>).chart!;

describe("chart insertion (spec 2.2 of plan charts)", () => {
  // Every test needs the command that Chart in the menus and Mod-Alt-g run, so each starts by asking for it.
  beforeEach(() => { insertChartCommand(); });

  // jsdom has no layout; CodeMirror measures text ranges.
  const originalRects = Range.prototype.getClientRects;
  const originalBounds = Range.prototype.getBoundingClientRect;
  beforeAll(() => {
    Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
    Range.prototype.getBoundingClientRect = () => new DOMRect();
  });
  afterAll(() => {
    Range.prototype.getClientRects = originalRects;
    Range.prototype.getBoundingClientRect = originalBounds;
  });

  const PNG = "iVBORw0KGgoAAAANSUhEUgAAACgAAAAUCAIAAABwJOjsAAAAJElEQVR4nGNoaPg/IIhh1OJRi0ctHrV41OJRi0ctHrV45FgMAPGJPTtbDo1MAAAAAElFTkSuQmCC";
  const DATA_URL = `data:image/png;base64,${PNG}`;
  const LABELS = ["Function Plot", "Function 3d Plot", "Scatter", "Line", "Area", "Contour", "Heatmap", "Pie", "Bar", "Surface 3d", "Scatter 3d", "Mesh 3d"];

  const chartViews: EditorView[] = [];
  const chartMounted: QmdEditorHandle[] = [];
  afterEach(() => {
    closeMenu();
    while (chartMounted.length > 0) { try { chartMounted.pop()!.destroy(); } catch { /* already destroyed */ } }
    while (chartViews.length > 0) chartViews.pop()!.destroy();
    document.body.innerHTML = "";
  });

  // ---------------------------------------------------------------------------------------------------------------- helpers

  function chartModel(): ChartModel {
    return {
      v: 1, id: "a1b2c3d4", kind: "data",
      data: { cols: [{ name: "t", values: [1, 2, 3] }, { name: "v", values: [10, 20, 30] }] },
      traces: [{ type: "scatter", x: "A", y: "B", mode: "lines" }],
      fns: [], vars: [],
      layout: { xaxis: { type: "linear" }, yaxis: { type: "linear" }, legend: { show: true } },
    };
  }
  const STORED = formatChartBlock({ model: chartModel(), png: { dataUrl: DATA_URL, widthCm: 16, alt: "Growth chart" }, pgf: null })!;

  function plotly(): PlotlyApi {
    const f = fakePlotly();
    return { ...f.api, toImage: jest.fn(async () => DATA_URL), newPlot: jest.fn(async () => undefined) } as unknown as PlotlyApi;
  }

  /** A loader that records every host the chart view opens an editor with. */
  function fakeLoader() {
    const hosts: ChartEditorHost[] = [];
    const close = jest.fn();
    const openChartEditor = jest.fn((host: ChartEditorHost) => { hosts.push(host); return { close }; });
    const loader = jest.fn(async () => ({ openChartEditor }));
    return { loader, hosts, close, openChartEditor };
  }

  type Loader = Parameters<typeof createChartView>[1];

  function open(doc: PmNode, loader: Loader, extra: Plugin[] = [], historyOptions: { newGroupDelay?: number } = {}): EditorView {
    const host = document.createElement("div");
    document.body.append(host);
    const view: EditorView = new EditorView(host, {
      state: EditorState.create({ doc, plugins: [editRequestPlugin(), history(historyOptions), keymap(qmdKeymap()), ...extra] }),
      nodeViews: { chart: createChartView(async () => plotly(), loader) },
      handleScrollToSelection: () => true,
      dispatchTransaction(tr) { view.updateState(view.state.apply(tr)); },
    });
    chartViews.push(view);
    return view;
  }

  const emptyAfterText = (): PmNode => s.node("doc", null, [para(text("Before")), para()]);
  const withStored = (): PmNode => s.node("doc", null, [para(text("Before")), s.node("chart", { raw: STORED, gap: "\n" }), para(text("After"))]);

  function caretAtEnd(view: EditorView): void {
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.doc.content.size - 1)));
  }
  const charts = (view: EditorView): PmNode[] => {
    const list: PmNode[] = [];
    view.state.doc.forEach((node) => { if (node.type.name === "chart") list.push(node); });
    return list;
  };
  function chartPos(view: EditorView): number {
    let found = -1;
    view.state.doc.forEach((node, offset) => { if (found < 0 && node.type.name === "chart") found = offset; });
    return found;
  }
  const run = (view: EditorView, command: Command): boolean => command(view.state, view.dispatch.bind(view), view);

  const dialog = (): HTMLElement | null => document.querySelector<HTMLElement>(".ls-dialog-full");
  const button = (label: RegExp): HTMLButtonElement | undefined =>
    [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => label.test((b.textContent ?? "").trim()));
  const TILE_SELECTOR = 'button, [role="button"], [role="option"], [role="radio"], [role="gridcell"], [role="menuitem"]';
  const tile = (root: ParentNode, label: string): HTMLElement | undefined =>
    [...root.querySelectorAll<HTMLElement>(TILE_SELECTOR)].find((el) => (el.getAttribute("aria-label") ?? el.textContent ?? "").trim() === label)
      ?? [...root.querySelectorAll<HTMLElement>(TILE_SELECTOR)].find((el) => (el.textContent ?? "").trim() === label);
  const pickerShown = (): boolean => dialog() !== null && LABELS.every((label) => tile(dialog()!, label) !== undefined);

  /** Dispatches Mod-Alt-g (Ctrl in jsdom, whose platform is not a Mac) to the editor's key handling. */
  function pressChartShortcut(view: EditorView): boolean {
    const event = new KeyboardEvent("keydown", { key: "g", code: "KeyG", keyCode: 71, ctrlKey: true, altKey: true, bubbles: true, cancelable: true });
    return view.someProp("handleKeyDown", (handle) => handle(view, event)) ?? false;
  }

  // ---------------------------------------------------------------------------------------------------------------- QMD_ACTIONS.chart

  describe("QMD_ACTIONS.chart", () => {
    it("2.2a is labelled Chart with the shortcut Mod-Alt-g and an icon that renders", () => {
      const chart = chartAction();
      expect(chart.id).toBe("chart");
      expect(chart.label).toBe("Chart");
      expect(chart.shortcut).toBe("Mod-Alt-g");
      expect(renderIcon(chart.icon)).toContain("<");
    });

    it("2.2a insertChartCommand inserts an empty chart node in place of the empty paragraph", () => {
      const { loader } = fakeLoader();
      const view = open(emptyAfterText(), loader as unknown as Loader);
      caretAtEnd(view);
      expect(run(view, insertChartCommand())).toBe(true);
      expect(charts(view)).toHaveLength(1);
      expect(charts(view)[0]!.attrs.raw).toBe("");
    });

    it("2.2a shares its shortcut with no other action", () => {
      const owners = Object.values(QMD_ACTIONS).filter((action) => action.shortcut === "Mod-Alt-g");
      expect(owners.map((action) => action.id)).toEqual(["chart"]);
    });

    it("2.2a binds Mod-Alt-g in the editor key map", () => {
      expect(typeof qmdKeymap()["Mod-Alt-g"]).toBe("function");
    });

    it("2.2a inserts an empty chart node in place of the empty paragraph", () => {
      const { loader } = fakeLoader();
      const view = open(emptyAfterText(), loader as unknown as Loader);
      caretAtEnd(view);
      expect(run(view, chartAction().command)).toBe(true);
      expect(charts(view)).toHaveLength(1);
      expect(charts(view)[0]!.attrs.raw).toBe("");
      expect(view.state.doc.textContent).toBe("Before");
    });

    it("2.2a opens the editor on a null model right after the command", async () => {
      const { loader, hosts } = fakeLoader();
      const view = open(emptyAfterText(), loader as unknown as Loader);
      caretAtEnd(view);
      run(view, chartAction().command);
      await until(() => hosts.length > 0);
      expect(hosts).toHaveLength(1);
      expect(hosts[0]!.model).toBeNull();
    });

    it("2.2a Mod-Alt-g inserts a chart and opens the editor", async () => {
      const { loader, hosts } = fakeLoader();
      const view = open(emptyAfterText(), loader as unknown as Loader);
      caretAtEnd(view);
      expect(pressChartShortcut(view)).toBe(true);
      expect(charts(view)).toHaveLength(1);
      await until(() => hosts.length > 0);
      expect(hosts[0]!.model).toBeNull();
    });

    it("2.2a Mod-Alt-g opens the picker of the real chart editor", async () => {
      const view = open(emptyAfterText(), loadChartEditor as unknown as Loader);
      caretAtEnd(view);
      pressChartShortcut(view);
      await until(pickerShown);
      expect(charts(view)).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------- the menus

  describe("the Insert panel", () => {
    const diagramSection = (view: EditorView, target: { place?: () => void } = {}) => {
      const panel = insertPanel(view, { language: "python", ...target });
      return panel.sections.find((section) => section.title === "Math and diagrams")!;
    };

    it("2.2a lists Chart right after Diagram in Math and diagrams", () => {
      const view = open(emptyAfterText(), undefined);
      expect(diagramSection(view).items.map((item) => item.label)).toEqual(["Equation", "Diagram", "Chart"]);
    });

    it("2.2a gives the Chart item the chart icon and its shortcut as hint", () => {
      const view = open(emptyAfterText(), undefined);
      const item = diagramSection(view).items[2]!;
      expect(item.icon).toBe(chartAction().icon);
      expect(item.hint).toMatch(/G$/i);
    });

    it("2.2a lists Chart right after Diagram in the panel a gap opens too", () => {
      const view = open(emptyAfterText(), undefined);
      expect(diagramSection(view, { place: () => undefined }).items.map((item) => item.label)).toEqual(["Equation", "Diagram", "Chart"]);
    });

    it("2.2a choosing Chart in the panel inserts a chart node and opens the editor on a null model", async () => {
      const { loader, hosts } = fakeLoader();
      const view = open(emptyAfterText(), loader as unknown as Loader);
      caretAtEnd(view);
      diagramSection(view).items[2]!.run();
      expect(charts(view)).toHaveLength(1);
      await until(() => hosts.length > 0);
      expect(hosts[0]!.model).toBeNull();
    });
  });

  describe("blockChoiceItems", () => {
    it("2.2a puts Chart right after Diagram", () => {
      const view = open(emptyAfterText(), undefined);
      const labels = blockChoiceItems(view, "python", () => undefined).map((item) => item.label);
      expect(labels).toEqual(["Cell (Python)", "Equation", "Diagram", "Chart"]);
    });

    it("2.2a gives the Chart choice the chart icon", () => {
      const view = open(emptyAfterText(), undefined);
      const chart = blockChoiceItems(view, "python", () => undefined).find((item) => item.label === "Chart");
      expect(chart?.icon).toBe(chartAction().icon);
    });

    it("2.2a places the selection first, then inserts the chart", async () => {
      const { loader, hosts } = fakeLoader();
      const view = open(emptyAfterText(), loader as unknown as Loader);
      const place = jest.fn(() => caretAtEnd(view));
      blockChoiceItems(view, "python", place).find((item) => item.label === "Chart")!.onSelect!();
      expect(place).toHaveBeenCalledTimes(1);
      expect(charts(view)).toHaveLength(1);
      await until(() => hosts.length > 0);
    });
  });

  describe("the gap menu and the empty note of a mounted editor", () => {
    const PY_NOTE = "intro\n\n```{python}\nx = 1\n```\n\nafter\n";
    function mountNote(body: string): { root: HTMLElement; handle: QmdEditorHandle } {
      const root = document.createElement("div");
      document.body.appendChild(root);
      const handle = mountQmdEditor(root, { body, onChange: () => undefined });
      chartMounted.push(handle);
      return { root, handle };
    }
    const gapButtons = (root: HTMLElement): HTMLButtonElement[] => [...root.querySelectorAll<HTMLButtonElement>(".qmd-insert-gap")];
    const menuLabels = (): string[] =>
      [...document.querySelectorAll<HTMLElement>(".ls-section-panel-section")].map((section) =>
        `${section.querySelector("h3")!.textContent}: ${[...section.querySelectorAll("button span")].map((label) => label.textContent).join(", ")}`);
    const menuItem = (label: string): HTMLButtonElement => {
      const hit = [...document.querySelectorAll<HTMLButtonElement>(".ls-section-panel button")].find((item) => item.querySelector("span")?.textContent === label);
      if (!hit) throw new Error(`no menu item ${label}`);
      return hit;
    };

    it("2.2a lists Chart right after Diagram in the gap menu", () => {
      const { root } = mountNote(PY_NOTE);
      expect(gapButtons(root).length).toBeGreaterThan(0);
      gapButtons(root)[1]!.click();
      expect(menuLabels()).toContain("Math and diagrams: Equation, Diagram, Chart");
    });

    it("2.2a choosing Chart in the gap menu inserts a chart there and opens the picker", async () => {
      const { root } = mountNote(PY_NOTE);
      gapButtons(root)[1]!.click();
      menuItem("Chart").click();
      expect(document.querySelector(".ls-section-panel")).toBeNull();
      await until(pickerShown);
    });

    it("2.2a lists Chart right after Diagram among the choices of an empty note", () => {
      const { root } = mountNote("");
      const labels = [...root.querySelectorAll<HTMLElement>(".qmd-empty-choices button")].map((b) => (b.textContent?.trim() || b.getAttribute("aria-label") || "").trim());
      expect(labels.indexOf("Diagram")).toBeGreaterThanOrEqual(0);
      expect(labels.indexOf("Chart")).toBe(labels.indexOf("Diagram") + 1);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------- Cancel on the picker

  describe("Cancel on the picker of a freshly inserted chart", () => {
    it("2.2b removes the empty chart node when the editor reports done(null)", async () => {
      const { loader, hosts } = fakeLoader();
      const view = open(emptyAfterText(), loader as unknown as Loader);
      caretAtEnd(view);
      run(view, chartAction().command);
      await until(() => hosts.length > 0);
      hosts[0]!.done(null);
      expect(charts(view)).toHaveLength(0);
      expect(view.state.doc.textContent).toBe("Before");
    });

    it("2.2b removes the empty chart when Cancel is clicked in the real picker", async () => {
      const view = open(emptyAfterText(), loadChartEditor as unknown as Loader);
      caretAtEnd(view);
      run(view, chartAction().command);
      await until(pickerShown);
      button(/^cancel$/i)!.click();
      await until(() => dialog() === null);
      expect(charts(view)).toHaveLength(0);
    });

    it("2.2b removes the empty node in the same undo step as the insertion", async () => {
      const original = emptyAfterText();
      const view = open(original, loadChartEditor as unknown as Loader, [], { newGroupDelay: 0 });
      caretAtEnd(view);
      run(view, chartAction().command);
      await until(pickerShown);
      button(/^cancel$/i)!.click();
      await until(() => dialog() === null);
      expect(charts(view)).toHaveLength(0);
      undo(view.state, view.dispatch.bind(view));
      expect(charts(view)).toHaveLength(0);
      expect(view.state.doc.eq(original)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------- A4

  describe("opening and cancelling a stored chart", () => {
    it("A4 Enter on a selected chart opens the editor with its model", async () => {
      const { loader, hosts } = fakeLoader();
      const view = open(withStored(), loader as unknown as Loader);
      view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, chartPos(view))));
      expect(qmdKeymap().Enter!(view.state, view.dispatch.bind(view), view)).toBe(true);
      await until(() => hosts.length > 0);
      expect(hosts[0]!.model).toEqual(readChartBlock(STORED)!.model);
    });

    it("A4 a click on the chart opens the editor with its model", async () => {
      const { loader, hosts } = fakeLoader();
      const view = open(withStored(), loader as unknown as Loader);
      let target = view.nodeDOM(chartPos(view)) as HTMLElement;
      while (target.firstElementChild) target = target.firstElementChild as HTMLElement;
      target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      await until(() => hosts.length > 0);
      expect(hosts[0]!.model?.id).toBe("a1b2c3d4");
    });

    it("A4 Cancel on a stored chart leaves its bytes and the document unchanged", async () => {
      const { loader, hosts } = fakeLoader();
      const original = withStored();
      const view = open(original, loader as unknown as Loader);
      view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, chartPos(view))));
      qmdKeymap().Enter!(view.state, view.dispatch.bind(view), view);
      await until(() => hosts.length > 0);
      hosts[0]!.done(null);
      expect(charts(view)).toHaveLength(1);
      expect(charts(view)[0]!.attrs.raw).toBe(STORED);
      expect(view.state.doc.eq(original)).toBe(true);
    });

    it("A4 Mod-Alt-g inside a note that already has a chart adds a second chart and leaves the first unchanged", async () => {
      const { loader, hosts } = fakeLoader();
      const doc = s.node("doc", null, [s.node("chart", { raw: STORED, gap: "\n" }), para()]);
      const view = open(doc, loader as unknown as Loader);
      caretAtEnd(view);
      pressChartShortcut(view);
      await until(() => hosts.length > 0);
      expect(charts(view)).toHaveLength(2);
      expect(charts(view)[0]!.attrs.raw).toBe(STORED);
      expect(hosts[0]!.model).toBeNull();
    });
  });

  describe("Apply and Ok on a picked chart", () => {
    async function insertAndPickLine(): Promise<EditorView> {
      const view = open(emptyAfterText(), loadChartEditor as unknown as Loader);
      caretAtEnd(view);
      run(view, chartAction().command);
      await until(pickerShown);
      tile(dialog()!, "Line")!.click();
      await until(() => button(/^ok$/i) !== undefined && button(/^apply$/i) !== undefined);
      return view;
    }

    it("A4 Ok writes the picked Line chart into the node and closes the editor", async () => {
      const view = await insertAndPickLine();
      button(/^ok$/i)!.click();
      await until(() => dialog() === null && charts(view)[0]?.attrs.raw !== "");
      const block = readChartBlock(charts(view)[0]!.attrs.raw as string)!;
      expect(block).not.toBeNull();
      expect(block.model.kind).toBe("data");
      expect(block.model.traces[0]!.type).toBe("scatter");
      expect(block.model.traces[0]!.mode).toBe("lines");
      expect(block.png?.dataUrl).toBe(DATA_URL);
    });

    it("A4 Apply writes the picked chart and keeps the editor open", async () => {
      const view = await insertAndPickLine();
      button(/^apply$/i)!.click();
      await until(() => charts(view)[0]?.attrs.raw !== "");
      expect(readChartBlock(charts(view)[0]!.attrs.raw as string)?.model.traces[0]!.mode).toBe("lines");
      expect(dialog()).not.toBeNull();
    });
  });
});
