/** @jest-environment jsdom */
/**
 * Tests the output node view with a stored labshelf-plot output, through the plot seam in outputPlot.test.ts: it draws the spec with an injected Plotly,
 * updates the same plot element in place for another plot, opens the interactive expand overlay, keeps pointer drags inside the figure for the plot, and purges on leaving or destroy.
 */
import type { Node as PmNode } from "prosemirror-model";
import type { NodeView, NodeViewConstructor } from "prosemirror-view";
import { qmdSchema as s } from "../../../src/qmd/editor/qmdSchema";
import { formatOutput, formatPlotContent, deriveCodeHash } from "../../../src/qmd/item/cellOutput";
import type { PlotSpec } from "../../../src/qmd/item/plotSpec";
import { createOutputView, formatRunTime } from "../../../src/qmd/dom/outputView";
import { mount, until, settle } from "../../support/nodeViewHarness";
import { createCodeCellView } from "../../../src/qmd/dom/codeCellView";
import { docToBody } from "../../../src/qmd/editor";

const SRC = "data:image/png;base64,iVBORw0KGgo=";
const IMAGE = { alt: "Python plot", src: SRC };

const SPEC_2D: PlotSpec = { v: 1, dim: 2, title: "Sine wave", axes: { x: { label: "x" }, y: { label: "y" } }, traces: [{ type: "line", name: "a", x: [0, 1, 2], y: [0, 1, 0] }] };
const SPEC_2D_B: PlotSpec = { v: 1, dim: 2, title: "Cosine wave", axes: { x: { label: "x" }, y: { label: "y" } }, traces: [{ type: "line", name: "b", x: [0, 1, 2], y: [1, 0, 1] }] };

type Fake = {
  react: jest.Mock;
  purge: jest.Mock;
  resize: jest.Mock;
  loader: jest.Mock;
};

/** An injected Plotly whose react resolves at once unless `react` says otherwise. */
function fakePlotly(react?: (...args: unknown[]) => Promise<unknown>, purge?: (root: HTMLElement) => void): Fake {
  const reactFn = jest.fn(react ?? (async () => ({})));
  const purgeFn = jest.fn(purge ?? (() => undefined));
  const resize = jest.fn();
  const api = { react: reactFn, purge: purgeFn, Plots: { resize } };
  return { react: reactFn, purge: purgeFn, resize, loader: jest.fn(async () => api) };
}

/** A promise-returning react that stays pending until `release()`. */
function pendingReact() {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  return { react: async () => { await gate; return {}; }, release: () => release() };
}

const rawOf = (content: string) => formatOutput({ cell: "plot", source: "s", engine: "python", ran: "2026-10-30", content });
const docOf = (content: string): PmNode => s.node("doc", null, [s.node("output", { raw: rawOf(content) })]);
const outputViewWith = (fake: Fake): NodeViewConstructor =>
  (createOutputView as unknown as (math?: unknown, plotly?: unknown) => NodeViewConstructor)(async () => ({ renderMathSvg: () => "<svg></svg>" }), fake.loader);

const mountPlot = (content: string, fake: Fake) => mount(docOf(content), { output: outputViewWith(fake) });
const plotRoot = (dom: ParentNode) => dom.querySelector<HTMLElement>(".qmd-output-plot");
const inlineRoot = (dom: ParentNode) => dom.querySelector<HTMLElement>(".qmd-output-plot:not(.qmd-plot-expanded)");
const expandButton = (dom: ParentNode) => dom.querySelector<HTMLButtonElement>(".qmd-output-expand");

function setContent(view: ReturnType<typeof mount>, content: string): void {
  view.dispatch(view.state.tr.setNodeMarkup(0, undefined, { ...view.state.doc.child(0).attrs, raw: rawOf(content) }));
}

describe("2.2 a stored plot output", () => {
  it("2.2a draws the spec into .qmd-output-plot with the injected Plotly", async () => {
    const fake = fakePlotly();
    const view = mountPlot(formatPlotContent(IMAGE, SPEC_2D), fake);
    await until(() => fake.react.mock.calls.length >= 1);
    const root = inlineRoot(view.dom)!;
    expect(root).not.toBeNull();
    expect(fake.react.mock.calls[0]![0]).toBe(root);
    expect(Array.isArray(fake.react.mock.calls[0]![1])).toBe(true);
  });

  it("2.2a marks the output with qmd-output-figure and qmd-output-interactive", async () => {
    const fake = fakePlotly();
    const view = mountPlot(formatPlotContent(IMAGE, SPEC_2D), fake);
    await until(() => fake.react.mock.calls.length >= 1);
    expect(view.dom.querySelector(".qmd-output-figure.qmd-output-interactive")).not.toBeNull();
  });

});

describe("2.2 a plot whose content changes", () => {
  it("2.2c keeps the same .qmd-output-plot element and calls react on it again", async () => {
    const fake = fakePlotly();
    const view = mountPlot(formatPlotContent(IMAGE, SPEC_2D), fake);
    await until(() => fake.react.mock.calls.length >= 1);
    await until(() => view.dom.querySelector(".qmd-output-image") === null);
    const root = inlineRoot(view.dom)!;
    setContent(view, formatPlotContent(IMAGE, SPEC_2D_B));
    await until(() => fake.react.mock.calls.length >= 2);
    expect(inlineRoot(view.dom)).toBe(root);
    expect(fake.react.mock.calls[1]![0]).toBe(root);
  });

  it("2.2c does not purge the plot when it updates to another plot", async () => {
    const fake = fakePlotly();
    const view = mountPlot(formatPlotContent(IMAGE, SPEC_2D), fake);
    await until(() => fake.react.mock.calls.length >= 1);
    setContent(view, formatPlotContent(IMAGE, SPEC_2D_B));
    await until(() => fake.react.mock.calls.length >= 2);
    await settle(20);
    expect(fake.purge).not.toHaveBeenCalled();
    expect(fake.loader).toHaveBeenCalledTimes(1);
  });

  it("2.2c draws again on a new root when the content changes after the plot failed", async () => {
    const fake = fakePlotly();
    fake.loader.mockImplementationOnce(async () => { throw new Error("plotly unavailable"); });
    const view = mountPlot(formatPlotContent(null, SPEC_2D), fake);
    await until(() => view.dom.querySelector(".qmd-plot-error") !== null);
    setContent(view, formatPlotContent(null, SPEC_2D_B));
    await until(() => fake.react.mock.calls.length >= 1);
    expect(fake.react.mock.calls[0]![0]).toBe(inlineRoot(view.dom));
    expect(view.dom.querySelector(".qmd-plot-error")).toBeNull();
  });

  it("2.2c purges the plot, before its element leaves, and shows the text when the content becomes text", async () => {
    let connectedAtPurge: boolean | null = null;
    const fake = fakePlotly(undefined, (root) => { connectedAtPurge = root.isConnected; });
    const view = mountPlot(formatPlotContent(IMAGE, SPEC_2D), fake);
    await until(() => fake.react.mock.calls.length >= 1);
    await until(() => view.dom.querySelector(".qmd-output-image") === null);
    const root = inlineRoot(view.dom)!;
    setContent(view, "result-text-42\n");
    await until(() => (view.dom.textContent ?? "").includes("result-text-42"));
    expect(fake.purge).toHaveBeenCalledTimes(1);
    expect(fake.purge.mock.calls[0]![0]).toBe(root);
    expect(connectedAtPurge).toBe(true);
    expect(plotRoot(view.dom)).toBeNull();
    expect(view.dom.querySelector(".qmd-output-text")!.textContent).toBe("result-text-42");
  });

  it("2.2c drops qmd-output-interactive when the content becomes text", async () => {
    const fake = fakePlotly();
    const view = mountPlot(formatPlotContent(IMAGE, SPEC_2D), fake);
    await until(() => fake.react.mock.calls.length >= 1);
    setContent(view, "plain\n");
    await until(() => view.dom.querySelector(".qmd-output-text") !== null);
    expect(view.dom.querySelector(".qmd-output-interactive")).toBeNull();
  });
});

describe("2.2 expanding a plot", () => {
  async function drawn(spec: PlotSpec = SPEC_2D, image: typeof IMAGE | null = IMAGE) {
    const fake = fakePlotly();
    const view = mountPlot(formatPlotContent(image, spec), fake);
    await until(() => fake.react.mock.calls.length >= 1);
    await settle(20);
    return { fake, view };
  }
  const panel = () => document.querySelector<HTMLElement>("section.qmd-plot-preview");
  const expandedRoot = () => panel()?.querySelector<HTMLElement>(".qmd-output-plot.qmd-plot-expanded") ?? null;

  it("2.2d opens .qmd-plot-preview holding its own .qmd-output-plot drawn by react", async () => {
    const { fake, view } = await drawn();
    const inline = inlineRoot(view.dom)!;
    expandButton(view.dom)!.click();
    await until(() => fake.react.mock.calls.length >= 2);
    const expanded = expandedRoot()!;
    expect(expanded).not.toBeNull();
    expect(expanded).not.toBe(inline);
    expect(fake.react.mock.calls[1]![0]).toBe(expanded);
    expect(panel()!.querySelector("img")).toBeNull();
  });

  it("2.2d opens the overlay with the title of the plot the node was last updated to", async () => {
    const { fake, view } = await drawn(SPEC_2D);
    setContent(view, formatPlotContent(IMAGE, SPEC_2D_B));
    await until(() => fake.react.mock.calls.length >= 2);
    await settle(20);
    expandButton(view.dom)!.click();
    await until(() => fake.react.mock.calls.length >= 3);
    expect(panel()!.querySelector("header")!.textContent).toContain("Cosine wave");
  });

  it("2.2d labels the overlay header with the spec title", async () => {
    const { view } = await drawn(SPEC_2D);
    expandButton(view.dom)!.click();
    expect(panel()!.querySelector("header")!.textContent).toContain("Sine wave");
  });

  it("2.2d purges the expanded root, and only it, when the close button closes the overlay", async () => {
    const { fake, view } = await drawn();
    const inline = inlineRoot(view.dom)!;
    expandButton(view.dom)!.click();
    await until(() => fake.react.mock.calls.length >= 2);
    await settle(20);
    const expanded = expandedRoot()!;
    document.querySelector<HTMLButtonElement>(".qmd-plot-close")!.click();
    expect(panel()).toBeNull();
    expect(fake.purge).toHaveBeenCalledTimes(1);
    expect(fake.purge.mock.calls[0]![0]).toBe(expanded);
    expect(fake.purge.mock.calls[0]![0]).not.toBe(inline);
  });

  it("2.2d keeps today's img overlay for an image-only output", () => {
    const fake = fakePlotly();
    const view = mountPlot(`![Python plot](${SRC})`, fake);
    expandButton(view.dom)!.click();
    const img = panel()!.querySelector<HTMLImageElement>("img")!;
    expect(img.src).toBe(SRC);
    expect(panel()!.querySelector(".qmd-output-plot")).toBeNull();
    expect(fake.loader).not.toHaveBeenCalled();
  });
});

describe("2.2 pointer events in the figure", () => {
  async function standalone(spec: PlotSpec = SPEC_2D) {
    const gate = pendingReact();
    const fake = fakePlotly(gate.react);
    const host = mount(docOf(formatPlotContent(IMAGE, spec)), {});
    const nv = outputViewWith(fake)(host.state.doc.child(0), host, () => 0, [], undefined as never) as NodeView;
    document.body.append(nv.dom);
    await until(() => plotRoot(nv.dom) !== null);
    return { nv, gate, root: plotRoot(nv.dom)! };
  }

  /** Dispatches the event and reports what stopEvent said while it was in flight and whether it stayed uncancelled. */
  function fire(target: Element, event: Event, nv: NodeView): { stop: boolean; notCancelled: boolean } {
    let stop = false;
    target.addEventListener(event.type, (e) => { stop = nv.stopEvent!(e); }, { once: true });
    const notCancelled = target.dispatchEvent(event);
    return { stop, notCancelled };
  }

  it("2.2e stopEvent is true for a mousedown inside the plot", async () => {
    const { nv, gate, root } = await standalone();
    expect(fire(root, new MouseEvent("mousedown", { bubbles: true, cancelable: true }), nv).stop).toBe(true);
    gate.release();
  });

  it("2.2e stopEvent is true for a mousedown on an element deep inside the plot", async () => {
    const { nv, gate, root } = await standalone();
    const inner = document.createElement("span");
    root.append(inner);
    expect(fire(inner, new MouseEvent("mousedown", { bubbles: true, cancelable: true }), nv).stop).toBe(true);
    gate.release();
  });

  it("2.2e stopEvent is true for a wheel event inside the plot", async () => {
    const { nv, gate, root } = await standalone();
    expect(fire(root, new Event("wheel", { bubbles: true, cancelable: true }), nv).stop).toBe(true);
    gate.release();
  });

  it("2.2e stopEvent is false for a dragstart inside the plot", async () => {
    const { nv, gate, root } = await standalone();
    expect(fire(root, new Event("dragstart", { bubbles: true, cancelable: true }), nv).stop).toBe(false);
    gate.release();
  });

  it("2.2e leaves a dragstart elsewhere on the output alone so the output can still be moved", async () => {
    const { nv, gate } = await standalone();
    const img = nv.dom.querySelector("img.qmd-output-image")!;
    const result = fire(img, new Event("dragstart", { bubbles: true, cancelable: true }), nv);
    expect(result.stop).toBe(false);
    expect(result.notCancelled).toBe(true);
    gate.release();
  });

  it("2.2e stops a mousedown elsewhere on a plot output, so a click never selects the output", async () => {
    const { nv, gate } = await standalone();
    const img = nv.dom.querySelector("img.qmd-output-image")!;
    expect(fire(img, new MouseEvent("mousedown", { bubbles: true, cancelable: true }), nv).stop).toBe(true);
    gate.release();
  });

  it("2.2e still stops events on the expand button", async () => {
    const { nv, gate } = await standalone();
    expect(fire(expandButton(nv.dom)!, new MouseEvent("mousedown", { bubbles: true, cancelable: true }), nv).stop).toBe(true);
    gate.release();
  });

  it("S3 stops events on the plot buttons so a click reaches them", async () => {
    const { nv, gate } = await standalone();
    for (const label of ["Reset view", "Download PNG", "Zoom in", "Zoom out", "More plot actions"]) {
      const button = nv.dom.querySelector<HTMLButtonElement>(`.qmd-plot-tools button[aria-label="${label}"]`)!;
      expect(fire(button, new MouseEvent("mousedown", { bubbles: true, cancelable: true }), nv).stop).toBe(true);
    }
    gate.release();
  });
});

describe("2.2 destroying and unchanged outputs", () => {
  it("2.2f purges the plot root when the view is destroyed", async () => {
    const fake = fakePlotly();
    const view = mountPlot(formatPlotContent(IMAGE, SPEC_2D), fake);
    await until(() => fake.react.mock.calls.length >= 1);
    await settle(20);
    const root = inlineRoot(view.dom)!;
    view.destroy();
    expect(fake.purge.mock.calls.map((call) => call[0])).toContain(root);
  });

  it("2.2f closes an open overlay and purges its plot when the view is destroyed", async () => {
    const fake = fakePlotly();
    const view = mountPlot(formatPlotContent(IMAGE, SPEC_2D), fake);
    await until(() => fake.react.mock.calls.length >= 1);
    expandButton(view.dom)!.click();
    await until(() => fake.react.mock.calls.length >= 2);
    await settle(20);
    const expanded = document.querySelector<HTMLElement>(".qmd-plot-preview .qmd-output-plot")!;
    view.destroy();
    expect(document.querySelector(".qmd-plot-preview")).toBeNull();
    expect(fake.purge.mock.calls.map((call) => call[0])).toContain(expanded);
  });

  it("2.2f renders an image-only output as an img without loading Plotly", () => {
    const fake = fakePlotly();
    const view = mountPlot(`![Python plot](${SRC})`, fake);
    const img = view.dom.querySelector<HTMLImageElement>("img.qmd-output-image")!;
    expect(img.src).toBe(SRC);
    expect(img.alt).toBe("Python plot");
    expect(view.dom.querySelector(".qmd-output-plot")).toBeNull();
    expect(view.dom.querySelector(".qmd-output-interactive")).toBeNull();
    expect(fake.loader).not.toHaveBeenCalled();
  });

  it("2.2f renders a text output as monospace text without loading Plotly", () => {
    const fake = fakePlotly();
    const view = mountPlot("result-text-42\n", fake);
    expect(view.dom.querySelector(".qmd-output-text")!.textContent).toBe("result-text-42");
    expect(view.dom.querySelector(".qmd-output-plot")).toBeNull();
    expect(view.dom.querySelector(".qmd-output-interactive")).toBeNull();
    expect(fake.loader).not.toHaveBeenCalled();
  });
});

/**
 * Tests what a run adds to the output view and the cell line (plan notebook-flow, 1.3): a discreet warnings band under the result,
 * the last run time on the cell line, and long text outputs cut to 30 lines with a Show all button.
 * The run info arrives as the `qmd-cell-ran` CustomEvent on the `.qmd-cell` element; the tests dispatch it by name.
 */
const CODE = "print(1)\n";
const CELL_RAN = "qmd-cell-ran";

async function docWith(content: string): Promise<PmNode> {
  const source = await deriveCodeHash(CODE);
  const raw = formatOutput({ cell: "bound", source, engine: "python-3.12", ran: "2026-10-22T09:15:03.000Z", content });
  return s.node("doc", null, [
    s.node("code_cell", { lang: "python", options: "#| label: bound\n", code: CODE, info: "{python}" }),
    s.node("output", { cell: "bound", source, engine: "python-3.12", ran: "2026-10-22T09:15:03.000Z", raw }),
  ]);
}

const views = () => ({
  code_cell: createCodeCellView(() => undefined),
  output: createOutputView(async () => ({ renderMathSvg: () => "<svg></svg>" })),
});

const cellOf = (view: { dom: HTMLElement }) => view.dom.querySelector<HTMLElement>(".qmd-cell")!;
const outputOf = (view: { dom: HTMLElement }) => view.dom.querySelector<HTMLElement>(".qmd-output:not(.qmd-cell-preview)")!;
const bandOf = (view: { dom: HTMLElement }) => view.dom.querySelector<HTMLElement>(".qmd-output-warnings");
const textOf = (view: { dom: HTMLElement }) => view.dom.querySelector(".qmd-output-text")!.textContent ?? "";
const lineCount = (text: string) => text.split("\n").length;

function ran(view: { dom: HTMLElement }, detail: { durationMs: number; warnings?: readonly string[] }): void {
  cellOf(view).dispatchEvent(new CustomEvent(CELL_RAN, { detail, bubbles: true }));
}

function showAll(view: { dom: HTMLElement }): HTMLButtonElement | null {
  return [...view.dom.querySelectorAll<HTMLButtonElement>("button")].find((b) => (b.textContent ?? "").startsWith("Show all")) ?? null;
}

const numbered = (n: number) => Array.from({ length: n }, (_, i) => `row ${String(i + 1).padStart(3, "0")} of the table`).join("\n") + "\n";

describe("1.3 formatRunTime", () => {
  it("1.3b formats 400 ms as 0.4 s", () => { expect(formatRunTime(400)).toBe("0.4 s"); });
  it("1.3b formats 1234 ms as 1.2 s", () => { expect(formatRunTime(1234)).toBe("1.2 s"); });
  it("1.3b formats 12000 ms as 12 s", () => { expect(formatRunTime(12000)).toBe("12 s"); });
  it("1.3b formats 125000 ms as 2 min 5 s", () => { expect(formatRunTime(125000)).toBe("2 min 5 s"); });
});

describe("1.3 the warnings band", () => {
  it("1.3a shows the result text and a band '2 warnings' after a run with two warnings", async () => {
    const view = mount(await docWith("result-text-42\n"), views());
    await until(() => cellOf(view) !== null && outputOf(view) !== null);
    await settle();
    ran(view, { durationMs: 50, warnings: ["alpha warning text", "beta warning text"] });
    await until(() => bandOf(view) !== null);
    expect(outputOf(view).contains(bandOf(view))).toBe(true);
    expect(bandOf(view)!.textContent).toContain("2 warnings");
    expect(textOf(view)).toBe("result-text-42");
  });

  it("1.3a expands the band to list both warnings", async () => {
    const view = mount(await docWith("result-text-42\n"), views());
    await settle();
    ran(view, { durationMs: 50, warnings: ["alpha warning text", "beta warning text"] });
    await until(() => bandOf(view) !== null);
    const toggle = bandOf(view)!.querySelector<HTMLElement>("button, summary");
    expect(toggle).not.toBeNull();
    toggle!.click();
    expect(bandOf(view)!.textContent).toContain("alpha warning text");
    expect(bandOf(view)!.textContent).toContain("beta warning text");
  });

  it("1.3a says '1 warning' for a single warning", async () => {
    const view = mount(await docWith("result-text-42\n"), views());
    await settle();
    ran(view, { durationMs: 50, warnings: ["only one"] });
    await until(() => bandOf(view) !== null);
    expect(bandOf(view)!.textContent).toMatch(/1 warning(?!s)/);
  });

  it("1.3a shows no band for a run without warnings", async () => {
    const view = mount(await docWith("result-text-42\n"), views());
    await settle();
    ran(view, { durationMs: 50 });
    await settle();
    expect(bandOf(view)).toBeNull();
    expect(textOf(view)).toBe("result-text-42");
  });

  it("1.3a shows no band for a run with an empty warnings list", async () => {
    const view = mount(await docWith("result-text-42\n"), views());
    await settle();
    ran(view, { durationMs: 50, warnings: [] });
    await settle();
    expect(bandOf(view)).toBeNull();
  });

  it("1.3a drops the band when the next run has no warnings", async () => {
    const view = mount(await docWith("result-text-42\n"), views());
    await settle();
    ran(view, { durationMs: 50, warnings: ["alpha warning text", "beta warning text"] });
    await until(() => bandOf(view) !== null);
    ran(view, { durationMs: 60 });
    await until(() => bandOf(view) === null);
    expect(bandOf(view)).toBeNull();
  });

  it("1.3a shows no band in a note reopened without a run in this view", async () => {
    const view = mount(await docWith("result-text-42\n"), views());
    await settle();
    expect(bandOf(view)).toBeNull();
    expect(view.dom.querySelector(".qmd-output-warnings")).toBeNull();
  });

  it("1.3a leaves the document unchanged", async () => {
    const view = mount(await docWith("result-text-42\n"), views());
    await settle();
    const before = view.state.doc;
    ran(view, { durationMs: 50, warnings: ["alpha warning text", "beta warning text"] });
    await until(() => bandOf(view) !== null);
    expect(view.state.doc.eq(before)).toBe(true);
    expect(docToBody(view.state.doc)).toBe(docToBody(before));
  });
});

describe("1.3 the run time on the cell line", () => {
  it("1.3b shows 1.2 s in the cell after qmd-cell-ran with durationMs 1234", async () => {
    const view = mount(await docWith("result-text-42\n"), views());
    await settle();
    ran(view, { durationMs: 1234 });
    await until(() => (cellOf(view).textContent ?? "").includes("1.2 s"));
    expect(cellOf(view).textContent).toContain("1.2 s");
  });

  it("1.3b shows the new time after a second run and drops the old one", async () => {
    const view = mount(await docWith("result-text-42\n"), views());
    await settle();
    ran(view, { durationMs: 1234 });
    await until(() => (cellOf(view).textContent ?? "").includes("1.2 s"));
    ran(view, { durationMs: 12000 });
    await until(() => (cellOf(view).textContent ?? "").includes("12 s"));
    expect(cellOf(view).textContent).not.toContain("1.2 s");
  });

  it("1.3b shows the time on a cell that has no output yet", async () => {
    const doc = s.node("doc", null, [s.node("code_cell", { lang: "python", options: "#| label: bound\n", code: CODE, info: "{python}" })]);
    const view = mount(doc, views());
    ran(view, { durationMs: 1234 });
    await until(() => (cellOf(view).textContent ?? "").includes("1.2 s"));
    expect(cellOf(view).textContent).toContain("1.2 s");
  });

  it("1.3b shows no run time in a note reopened without a run in this view", async () => {
    const view = mount(await docWith("result-text-42\n"), views());
    await settle();
    expect(view.dom.textContent).not.toMatch(/\d s\b/);
    expect(view.dom.textContent).not.toMatch(/\bmin\b/);
  });

  it("1.3b leaves the document unchanged", async () => {
    const view = mount(await docWith("result-text-42\n"), views());
    await settle();
    const before = view.state.doc;
    ran(view, { durationMs: 1234 });
    await until(() => (cellOf(view).textContent ?? "").includes("1.2 s"));
    expect(view.state.doc.eq(before)).toBe(true);
  });
});

describe("1.3 long text outputs", () => {
  it("1.3c renders 30 lines and a 'Show all (100 lines)' button for a 100-line text output", async () => {
    const view = mount(await docWith(numbered(100)), views());
    await until(() => view.dom.querySelector(".qmd-output-text") !== null);
    expect(lineCount(textOf(view))).toBe(30);
    expect(textOf(view)).toContain("row 030 of the table");
    expect(textOf(view)).not.toContain("row 031 of the table");
    expect(showAll(view)!.textContent).toBe("Show all (100 lines)");
  });

  it("1.3c shows all 100 lines when Show all is clicked", async () => {
    const view = mount(await docWith(numbered(100)), views());
    await until(() => showAll(view) !== null);
    showAll(view)!.click();
    expect(lineCount(textOf(view))).toBe(100);
    expect(textOf(view)).toContain("row 100 of the table");
  });

  it("1.3c does not change the document when Show all is clicked", async () => {
    const view = mount(await docWith(numbered(100)), views());
    await until(() => showAll(view) !== null);
    const before = view.state.doc;
    const body = docToBody(before);
    showAll(view)!.click();
    await settle();
    expect(view.state.doc.eq(before)).toBe(true);
    expect(docToBody(view.state.doc)).toBe(body);
  });

  it("1.3c leaves exactly 30 lines whole with no Show all", async () => {
    const view = mount(await docWith(numbered(30)), views());
    await until(() => view.dom.querySelector(".qmd-output-text") !== null);
    await settle();
    expect(lineCount(textOf(view))).toBe(30);
    expect(showAll(view)).toBeNull();
  });

  it("1.3c cuts 31 lines to 30 with 'Show all (31 lines)'", async () => {
    const view = mount(await docWith(numbered(31)), views());
    await until(() => showAll(view) !== null);
    expect(lineCount(textOf(view))).toBe(30);
    expect(showAll(view)!.textContent).toBe("Show all (31 lines)");
  });

  it("1.3c cuts a text of few lines but over 3000 characters to its first 3000 characters", async () => {
    const lines = Array.from({ length: 10 }, (_, i) => `${i}`.repeat(400));
    const view = mount(await docWith(lines.join("\n") + "\n"), views());
    await until(() => showAll(view) !== null);
    expect(textOf(view).length).toBeLessThanOrEqual(3000);
    expect(textOf(view).startsWith(lines[0]!)).toBe(true);
    expect(showAll(view)!.textContent).toBe("Show all (10 lines)");
    showAll(view)!.click();
    expect(textOf(view)).toBe(lines.join("\n"));
  });

  it("1.3c does not cut a short text output", async () => {
    const view = mount(await docWith("result-text-42\n"), views());
    await settle();
    expect(showAll(view)).toBeNull();
    expect(textOf(view)).toBe("result-text-42");
  });

  it("1.3c does not cut a long image output", async () => {
    const view = mount(await docWith("![Python plot](data:image/png;base64,iVBORw0KGgo=)\n"), views());
    await settle();
    expect(view.dom.querySelector(".qmd-output-image")).not.toBeNull();
    expect(showAll(view)).toBeNull();
  });
});

describe("1.3 the run info acceptance", () => {
  it("A5 shows the run time on the cell line and truncates long text with Show all", async () => {
    const view = mount(await docWith(numbered(100)), views());
    await until(() => showAll(view) !== null);
    ran(view, { durationMs: 1234 });
    await until(() => (cellOf(view).textContent ?? "").includes("1.2 s"));
    expect(lineCount(textOf(view))).toBe(30);
    expect(showAll(view)!.textContent).toBe("Show all (100 lines)");
  });
});
