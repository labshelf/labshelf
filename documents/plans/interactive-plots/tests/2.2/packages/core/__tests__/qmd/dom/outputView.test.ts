/** @jest-environment jsdom */
/**
 * Tests the output node view with a stored labshelf-plot output, through the plot seam in outputPlot.test.ts: it draws the spec with an injected Plotly,
 * updates the same plot element in place for another plot, opens the interactive expand overlay, keeps pointer drags inside the figure for the plot, and purges on leaving or destroy.
 */
import type { Node as PmNode } from "prosemirror-model";
import type { NodeView, NodeViewConstructor } from "prosemirror-view";
import { qmdSchema as s } from "../../../src/qmd/editor/qmdSchema";
import { formatOutput, formatPlotContent } from "../../../src/qmd/item/cellOutput";
import type { PlotSpec } from "../../../src/qmd/plot/plotSpec";
import { createOutputView } from "../../../src/qmd/dom/outputView";
import { mount, until, settle } from "../../support/nodeViewHarness";

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

  it("2.2e does not stop a mousedown elsewhere on the output", async () => {
    const { nv, gate } = await standalone();
    const img = nv.dom.querySelector("img.qmd-output-image")!;
    expect(fire(img, new MouseEvent("mousedown", { bubbles: true, cancelable: true }), nv).stop).toBe(false);
    gate.release();
  });

  it("2.2e still stops events on the expand button", async () => {
    const { nv, gate } = await standalone();
    expect(fire(expandButton(nv.dom)!, new MouseEvent("mousedown", { bubbles: true, cancelable: true }), nv).stop).toBe(true);
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
