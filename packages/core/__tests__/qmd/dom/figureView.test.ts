/** @jest-environment jsdom */
/**
 * Tests the chart node (plan charts, D1, D2, D10): a labshelf-chart div read from a note into a chart node that keeps its raw
 * bytes and writes back verbatim, a malformed one kept as raw text, and the node view that draws the model with Plotly
 * (through a fake PlotlyApi handed in by the loader), redraws on a theme change, purges on destroy and falls back to the stored PNG.
 */
import type { Node as PmNode } from "prosemirror-model";
import type { EditorView } from "prosemirror-view";
import { bodyToDoc, docToBody } from "../../../src/qmd/editor/qmdDoc";
import { qmdSchema as s } from "../../../src/qmd/editor/qmdSchema";
import { formatChartBlock } from "../../../src/qmd/chart/block";
import { chartFigure } from "../../../src/qmd/chart/figure";
import { formatChartPgf } from "../../../src/qmd/chart/pgf";
import type { ChartModel, ChartTable } from "../../../src/qmd/chart/model";
import { createChartView, type ChartEditorLoader } from "../../../src/qmd/dom/figureView";
import { outlineOf } from "../../../src/qmd/dom/noteOutline";
import { readPlotTheme, type PlotlyLoader } from "../../../src/qmd/dom/plotView";
import { deferred, fakePlotly, flush, type Fake } from "./plotViewHarness";
import { mount, para, text, until } from "../../support/nodeViewHarness";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAACgAAAAUCAIAAABwJOjsAAAAJElEQVR4nGNoaPg/IIhh1OJRi0ctHrV41OJRi0ctHrV45FgMAPGJPTtbDo1MAAAAAElFTkSuQmCC";
const DATA_URL = `data:image/png;base64,${PNG}`;
const PGF = [
  "\\begin{tikzpicture}",
  "\\begin{axis}[width=16cm]",
  "\\addplot coordinates {(1,10) (2,20) (3,30)};",
  "\\end{axis}",
  "\\end{tikzpicture}",
].join("\n");

const TABLE: ChartTable = {
  cols: [
    { name: "t", values: [1, 2, 3] },
    { name: "v", values: [10, 20, 30] },
  ],
};

function chartModel(extra: Partial<ChartModel> = {}): ChartModel {
  return {
    v: 1,
    id: "a1b2c3d4",
    kind: "data",
    data: TABLE,
    traces: [{ type: "scatter", x: "A", y: "B", mode: "lines" }],
    fns: [],
    vars: [],
    layout: { xaxis: { type: "linear" }, yaxis: { type: "linear" }, legend: { show: true } },
    ...extra,
  };
}

interface Options { model?: ChartModel; png?: boolean; pgf?: boolean; eol?: "\n" | "\r\n" }

/** A chart block as the writer of session 1.2 stores it, ending with a line break. */
function chartText(options: Options = {}): string {
  const { model = chartModel(), png = true, pgf = false, eol = "\n" } = options;
  const out = formatChartBlock({ model, png: png ? { dataUrl: DATA_URL, widthCm: 16, alt: "Growth chart" } : null, pgf: pgf ? PGF : null }, eol);
  if (out === null) throw new Error("formatChartBlock returned null for a small chart");
  return out.endsWith("\n") ? out : out + eol;
}

const types = (doc: PmNode): string[] => doc.content.content.map((node) => node.type.name);

describe("chart node reading and writing", () => {
  let chart: string;
  beforeEach(() => {
    createChartView(async () => fakePlotly().api);
    chart = chartText();
  });

  /** A body holding the chart block between two paragraphs, and the document read from it. */
  const exact = (body: string): PmNode => {
    const doc = bodyToDoc(body);
    expect(() => doc.check()).not.toThrow();
    expect(docToBody(doc)).toBe(body);
    return doc;
  };

  it("1.3a reads a top-level chart div as one atom chart node holding its exact bytes", () => {
    const doc = bodyToDoc(`Before.\n\n${chart}\nAfter.\n`);
    expect(types(doc)).toEqual(["paragraph", "chart", "paragraph"]);
    expect(doc.child(1).isAtom).toBe(true);
    expect(doc.child(1).attrs.raw).toBe(chart);
  });

  it("1.3a keeps the blank lines before a chart in its gap, not in raw", () => {
    const doc = bodyToDoc(`Before.\n\n\n\n${chart}`);
    expect(types(doc)).toEqual(["paragraph", "chart"]);
    expect(doc.child(1).attrs.gap).toBe("\n\n\n");
    expect(doc.child(1).attrs.raw).toBe(chart);
  });

  it("1.3a reads a chart div that is the whole body, and two in a row as two nodes", () => {
    expect(types(bodyToDoc(chart))).toEqual(["chart"]);
    expect(types(bodyToDoc(`${chart}\n${chart}`))).toEqual(["chart", "chart"]);
  });

  it("1.3a gives the chart node the text of its raw bytes as leaf text", () => {
    const doc = bodyToDoc(chart);
    expect(doc.textBetween(0, doc.content.size)).toBe(chart);
  });

  it("1.3a serialises a note with charts byte-identical", () => {
    const body = `# Title\n\nBefore.\n\n${chart}\nMiddle $x^2$.\n\n${chart}\n- list\n- items\n`;
    expect(types(exact(body))).toContain("chart");
  });

  it("1.3a serialises a chart with a pgfplots part byte-identical", () => {
    const withPgf = chartText({ pgf: true });
    const body = `Before.\n\n${withPgf}\nAfter.\n`;
    expect(types(exact(body))).toEqual(["paragraph", "chart", "paragraph"]);
    expect(bodyToDoc(body).child(1).attrs.raw).toBe(withPgf);
  });

  it("1.3a serialises a chart without a PNG byte-identical", () => {
    const bare = chartText({ png: false });
    expect(types(exact(`Before.\n\n${bare}`))).toEqual(["paragraph", "chart"]);
  });

  it("1.3a serialises a CRLF note with a CRLF chart byte-identical and keeps the CRLF in raw", () => {
    const crlf = chartText({ eol: "\r\n" });
    const body = `Before.\r\n\r\n${crlf}\r\nAfter.\r\n`;
    const doc = exact(body);
    expect(types(doc)).toEqual(["paragraph", "chart", "paragraph"]);
    expect(doc.child(1).attrs.raw).toBe(crlf);
  });

  it("1.3a serialises a chart with a missing final newline byte-identical", () => {
    const body = `Before.\n\n${chart.slice(0, -1)}`;
    expect(types(exact(body))).toEqual(["paragraph", "chart"]);
  });

  it("1.3a serialises a replaced chart's raw back exactly", () => {
    const replaced = chartText({ model: chartModel({ title: "Replaced" }) });
    const doc = s.node("doc", { eol: "\n", trailing: "", unterminated: false }, [para(text("Before.")), s.node("chart", { raw: replaced, gap: "\n" })]);
    expect(() => doc.check()).not.toThrow();
    expect(docToBody(doc)).toBe(`Before.\n\n${replaced}`);
  });
});

describe("chart node rejection", () => {
  let chart: string;
  beforeEach(() => {
    createChartView(async () => fakePlotly().api);
    chart = chartText();
  });

  /** A malformed body is kept as raw text, written back byte for byte, and a valid chart after it still reads as a chart. */
  const staysRaw = (malformed: string): void => {
    const body = `${malformed}\n${chart}`;
    const doc = bodyToDoc(body);
    expect(() => doc.check()).not.toThrow();
    expect(types(doc)).toEqual(["raw_block", "chart"]);
    expect(docToBody(doc)).toBe(body);
  };

  const MODEL_FENCE = /```\{=labshelf-chart\}\r?\n[^\r\n]*\r?\n```\r?\n?/;

  it("1.3a keeps a chart div whose model JSON is not JSON as raw text", () => {
    staysRaw(chart.replace(/```\{=labshelf-chart\}\n[^\n]*\n```/, "```{=labshelf-chart}\n{not json\n```"));
  });

  it("1.3a keeps a chart div whose model is invalid as raw text", () => {
    staysRaw(chart.replace('"v":1', '"v":2'));
  });

  it("1.3a keeps a chart div with an unknown trace type as raw text", () => {
    staysRaw(chart.replace('"type":"scatter"', '"type":"radar"'));
  });

  it("1.3a keeps a chart div missing its model fence as raw text", () => {
    staysRaw(chart.replace(MODEL_FENCE, ""));
  });

  it("1.3a keeps a chart div with its model fence before its PNG as raw text", () => {
    const fence = MODEL_FENCE.exec(chart)?.[0];
    if (fence === undefined) throw new Error("no model fence in the formatted chart");
    const without = chart.replace(MODEL_FENCE, "");
    const at = without.indexOf("\n") + 1;
    staysRaw(without.slice(0, at) + fence.replace(/\n?$/, "\n\n") + without.slice(at));
  });

  it("1.3a keeps a chart div with a bad pgfplots guard as raw text", () => {
    staysRaw(chartText({ pgf: true }).replace("\\@ifundefined{pgfplotsset}", "\\@ifundefined{somethingelse}"));
  });

  it("1.3a keeps a chart div that never closes as raw text", () => {
    const unclosed = chart.replace(/\n:::\r?\n?$/, "\n");
    const doc = bodyToDoc(unclosed);
    expect(() => doc.check()).not.toThrow();
    expect(types(doc)).toEqual(["raw_block"]);
    expect(docToBody(doc)).toBe(unclosed);
  });

  it("A2 shows a malformed chart as its raw text, byte for byte, in the raw block", () => {
    const malformed = chart.replace('"v":1', '"v":2');
    const doc = bodyToDoc(malformed);
    expect(types(doc)).toEqual(["raw_block"]);
    expect(doc.child(0).attrs.text).toBe(malformed);
  });
});

describe("chart node view", () => {
  let fake: Fake;
  let sheet: HTMLStyleElement;

  beforeEach(() => {
    fake = fakePlotly();
    sheet = document.createElement("style");
    sheet.textContent = '* { --ls-fg: #111111; --qmd-plot-palette: #aa0000, #00aa00, #0000aa } :root[data-theme="dark"] * { --ls-fg: #eeeeee }';
    document.head.append(sheet);
    createChartView(async () => fake.api);
  });

  afterEach(() => {
    sheet.remove();
    document.documentElement.removeAttribute("data-theme");
  });

  const loaderOf = (f: Fake): PlotlyLoader => async () => f.api;

  function open(options: Options = {}, loader: PlotlyLoader = loaderOf(fake), openEditor?: ChartEditorLoader): EditorView {
    const raw = chartText(options);
    const doc = s.node("doc", { eol: "\n", trailing: "", unterminated: false }, [para(text("Before")), s.node("chart", { raw, gap: "\n" }), para(text("After"))]);
    return mount(doc, { chart: createChartView(loader, openEditor) });
  }

  /** The element the first Plotly.react call drew into. */
  const drawnRoot = (): HTMLElement => fake.react.mock.calls[0]![0] as HTMLElement;

  const themeOf = (element: HTMLElement) => {
    const theme = readPlotTheme(element);
    return { fg: theme.text, muted: theme.muted, grid: theme.grid, font: theme.font, palette: theme.palette };
  };

  const chartPos = (view: EditorView): number => {
    let found = -1;
    view.state.doc.forEach((node, offset) => { if (found < 0 && node.type.name === "chart") found = offset; });
    return found;
  };

  const images = (view: EditorView): HTMLImageElement[] => Array.from(view.dom.querySelectorAll("img"));

  it("1.3c calls Plotly.react once, inside the chart's view, with the figure of the model", async () => {
    const view = open();
    await until(() => fake.react.mock.calls.length > 0);
    await flush();
    expect(fake.react).toHaveBeenCalledTimes(1);
    const [rootElement, data, layout] = fake.react.mock.calls[0]!;
    expect(view.dom.contains(rootElement as HTMLElement)).toBe(true);
    const expected = chartFigure(chartModel(), TABLE, themeOf(rootElement as HTMLElement));
    expect(data).toEqual(expected.data);
    expect(layout).toEqual(expect.objectContaining(expected.layout));
  });

  it("1.3c draws without the Plotly mode bar", async () => {
    open();
    await until(() => fake.react.mock.calls.length > 0);
    const config = fake.react.mock.calls[0]![3] as { displayModeBar?: boolean } | undefined;
    expect(chartFigure(chartModel(), TABLE, themeOf(drawnRoot())).data.length).toBeGreaterThan(0);
    expect(config?.displayModeBar).toBe(false);
  });

  it("1.3c draws the palette colours the page gives", async () => {
    open();
    await until(() => fake.react.mock.calls.length > 0);
    expect(JSON.stringify(fake.react.mock.calls[0]![1])).toContain("#aa0000");
  });

  it("1.3c redraws on a theme change with the new theme", async () => {
    open();
    await until(() => fake.react.mock.calls.length > 0);
    await flush();
    expect(JSON.stringify(fake.react.mock.calls[0]![2])).toContain("#111111");
    expect(fake.react).toHaveBeenCalledTimes(1);
    document.documentElement.setAttribute("data-theme", "dark");
    await flush();
    expect(fake.react).toHaveBeenCalledTimes(2);
    expect(fake.react.mock.calls[1]![0]).toBe(drawnRoot());
    expect(JSON.stringify(fake.react.mock.calls[1]![2])).toContain("#eeeeee");
    expect(JSON.stringify(fake.react.mock.calls[1]![2])).not.toContain("#111111");
  });

  it("1.3c purges the drawn plot when the editor is destroyed", async () => {
    const view = open();
    await until(() => fake.react.mock.calls.length > 0);
    await flush();
    const drawn = drawnRoot();
    expect(fake.purge).not.toHaveBeenCalled();
    view.destroy();
    expect(fake.purge).toHaveBeenCalledWith(drawn);
  });

  it("1.3c purges the drawn plot when the chart node is deleted", async () => {
    const view = open();
    await until(() => fake.react.mock.calls.length > 0);
    await flush();
    const drawn = drawnRoot();
    const pos = chartPos(view);
    view.dispatch(view.state.tr.delete(pos, pos + view.state.doc.nodeAt(pos)!.nodeSize));
    await flush();
    expect(fake.purge).toHaveBeenCalledWith(drawn);
  });

  it("1.3c does not redraw after destroy when the theme changes", async () => {
    const view = open();
    await until(() => fake.react.mock.calls.length > 0);
    await flush();
    view.destroy();
    document.documentElement.setAttribute("data-theme", "dark");
    await flush();
    expect(fake.react).toHaveBeenCalledTimes(1);
  });

  it("1.3c shows the stored PNG when the loader rejects", async () => {
    const view = open({}, async () => { throw new Error("boom"); });
    await flush();
    const shown = images(view);
    expect(shown).toHaveLength(1);
    expect(shown[0]!.getAttribute("src")).toBe(DATA_URL);
    expect(fake.react).not.toHaveBeenCalled();
  });

  it("1.3c shows the stored PNG while Plotly is still loading", async () => {
    const pending = deferred<Fake["api"]>();
    const view = open({}, () => pending.promise);
    await flush();
    expect(images(view)[0]?.getAttribute("src")).toBe(DATA_URL);
    pending.resolve(fake.api);
    await until(() => fake.react.mock.calls.length > 0);
  });

  it("1.3c shows a placeholder with the error text when the loader rejects and there is no PNG", async () => {
    const view = open({ png: false }, async () => { throw new Error("boom"); });
    await flush();
    expect(images(view)).toHaveLength(0);
    expect(view.dom.textContent).toContain("Data chart");
    expect(view.dom.textContent).toContain("boom");
  });

  it("1.3c shows the stored PNG of a 3D function chart and does not draw it yet", async () => {
    const { data: _table, ...rest } = chartModel();
    const model: ChartModel = { ...rest, kind: "fn3d", traces: [], fns: [{ kind: "y", expr: ["x^2"] }] };
    const view = open({ model });
    await flush();
    expect(images(view)[0]?.getAttribute("src")).toBe(DATA_URL);
    expect(fake.react).not.toHaveBeenCalled();
  });

  it("A2 views a chart without opening the editor", async () => {
    const openEditor = jest.fn((): ReturnType<ChartEditorLoader> => new Promise(() => undefined));
    open({}, loaderOf(fake), openEditor);
    await until(() => fake.react.mock.calls.length > 0);
    await flush();
    expect(openEditor).not.toHaveBeenCalled();
  });

  it("A2 views a chart with the Plotly loader only, loading it once for the chart", async () => {
    const loader = jest.fn(loaderOf(fake));
    open({}, loader);
    await until(() => fake.react.mock.calls.length > 0);
    await flush();
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("A2 lists a titled chart in the outline as 'Chart: <title>' figure", async () => {
    const view = open({ model: chartModel({ title: "Growth" }) });
    await flush();
    const entry = outlineOf(view).find((candidate) => candidate.label.startsWith("Chart"));
    expect(entry).toBeDefined();
    expect(entry!.kind).toBe("figure");
    expect(entry!.label).toBe("Chart: Growth");
    expect(entry!.pos).toBe(chartPos(view));
  });

  it("A2 lists an untitled chart in the outline with its kind", async () => {
    const view = open();
    await flush();
    const entry = outlineOf(view).find((candidate) => candidate.label.startsWith("Chart: "));
    expect(entry).toBeDefined();
    expect(entry!.label.toLowerCase()).toContain("data");
  });

  /** Opens the chart's editor through a fake that writes `next` at once, and gives the committed raw block. */
  async function commit(next: ChartModel): Promise<string> {
    const openEditor = (async () => ({
      openChartEditor: (host: { done(result: { model: ChartModel; png: null } | null): void }) => {
        queueMicrotask(() => host.done({ model: next, png: null }));
        return { close: () => undefined };
      },
    })) as unknown as ChartEditorLoader;
    const view = open({}, loaderOf(fake), openEditor);
    await flush();
    let target = view.nodeDOM(chartPos(view)) as HTMLElement;
    while (target.firstElementChild) target = target.firstElementChild as HTMLElement;
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await until(() => (view.state.doc.nodeAt(chartPos(view))!.attrs.raw as string).includes(next.id));
    return view.state.doc.nodeAt(chartPos(view))!.attrs.raw as string;
  }

  it("6.3a committing an fn3d surface chart writes its pgfplots picture in the guarded latex part", async () => {
    const { data: _table, ...rest } = chartModel();
    const model: ChartModel = {
      ...rest,
      id: "b2c3d4e5",
      kind: "fn3d",
      traces: [],
      fns: [{ kind: "surface", expr: ["exp(-x^2-y^2)"], domain: [-2, 2], domain2: [-2, 2] }],
      layout: { ...rest.layout, zaxis: { type: "linear" } },
    };
    const raw = await commit(model);
    const pgf = formatChartPgf(model, null);
    expect(pgf).not.toBeNull();
    expect(raw).toContain("```{=latex}\n\\makeatletter\\@ifundefined{pgfplotsset}{\\iftrue}{" + pgf!);
  });

  it("6.3b committing a pie chart writes no latex part", async () => {
    const model = chartModel({ id: "c3d4e5f6", traces: [{ type: "pie", x: "A", y: "B" }] });
    const raw = await commit(model);
    expect(raw).not.toContain("{=latex}");
    expect(raw).not.toContain("pgfplotsset");
  });
});
