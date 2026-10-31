/** @jest-environment jsdom */
/**
 * Tests the plot seam of the output view with a fake Plotly loader: renderOutputPlot fills an output body with the figure over its PNG fallback,
 * updates it in place, keeps the PNG or shows an error line when drawing fails, and destroys it; openPlotFigure and openPlotImage open the expand overlays.
 */
import { renderOutputPlot, openPlotFigure, openPlotImage, type OutputPlot, type OutputPlotContent } from "../../../src/qmd/dom/outputPlot";
import type { PlotSpec } from "../../../src/qmd/item/plotSpec";
import { until, settle } from "../../support/nodeViewHarness";

const SRC = "data:image/png;base64,iVBORw0KGgo=";
const IMAGE = { alt: "Python plot", src: SRC };

const SPEC_2D: PlotSpec = { v: 1, dim: 2, title: "Sine wave", axes: { x: { label: "x" }, y: { label: "y" } }, traces: [{ type: "line", name: "a", x: [0, 1, 2], y: [0, 1, 0] }] };
const SPEC_2D_B: PlotSpec = { v: 1, dim: 2, title: "Cosine wave", axes: { x: { label: "x" }, y: { label: "y" } }, traces: [{ type: "line", name: "b", x: [0, 1, 2], y: [1, 0, 1] }] };
const SPEC_3D: PlotSpec = { v: 1, dim: 3, title: "Bowl", axes: { x: { label: "x" }, y: { label: "y" }, z: { label: "z" } }, traces: [{ type: "surface", x: [0, 1], y: [0, 1], z: [[0, 1], [1, 0]] }] };
const SPEC_UNTITLED: PlotSpec = { v: 1, dim: 2, axes: { x: {}, y: {} }, traces: [{ type: "line", x: [0, 1], y: [0, 1] }] };

type Fake = { react: jest.Mock; purge: jest.Mock; resize: jest.Mock; loader: jest.Mock };

/** An injected Plotly whose react resolves at once unless `react` says otherwise. */
function fakePlotly(react?: (...args: unknown[]) => Promise<unknown>): Fake {
  const reactFn = jest.fn(react ?? (async () => ({})));
  const purgeFn = jest.fn();
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

const failingLoader = (): Fake => {
  const fake = fakePlotly();
  fake.loader.mockImplementation(async () => { throw new Error("plotly unavailable"); });
  return fake;
};

const content = (spec: PlotSpec, image: OutputPlotContent["image"] = IMAGE): OutputPlotContent => ({ image, spec });

function setup(fake: Fake, plot: OutputPlotContent): { body: HTMLElement; expand: HTMLButtonElement; handle: OutputPlot } {
  const body = document.createElement("div");
  const expand = document.createElement("button");
  expand.className = "qmd-output-expand";
  document.body.append(body);
  body.append(document.createElement("span"));
  const handle = renderOutputPlot(body, plot, expand, fake.loader);
  return { body, expand, handle };
}
const rootOf = (body: ParentNode) => body.querySelector<HTMLElement>(".qmd-output-plot");
const imgOf = (body: ParentNode) => body.querySelector<HTMLImageElement>("img.qmd-output-image");

describe("2.2 renderOutputPlot draws a stored plot into an output body", () => {
  it("2.2a replaces the body's children with the img, the plot root, then the expand button", async () => {
    const gate = pendingReact();
    const fake = fakePlotly(gate.react);
    const { body, expand } = setup(fake, content(SPEC_2D));
    expect(Array.from(body.children).map((child) => child.tagName)).toEqual(["IMG", "DIV", "BUTTON"]);
    expect(body.children[0]).toBe(imgOf(body));
    expect(body.children[1]).toBe(rootOf(body));
    expect(body.children[2]).toBe(expand);
    gate.release();
  });

  it("2.2a draws the spec into the plot root with the injected Plotly", async () => {
    const fake = fakePlotly();
    const { body } = setup(fake, content(SPEC_2D));
    await until(() => fake.react.mock.calls.length >= 1);
    expect(fake.react.mock.calls[0]![0]).toBe(rootOf(body));
    expect(Array.isArray(fake.react.mock.calls[0]![1])).toBe(true);
  });

  it("2.2a shows the PNG, with the plot root loading, until the plot is drawn", async () => {
    const gate = pendingReact();
    const fake = fakePlotly(gate.react);
    const { body } = setup(fake, content(SPEC_2D));
    await until(() => fake.react.mock.calls.length >= 1);
    await settle(20);
    expect(imgOf(body)!.src).toBe(SRC);
    expect(rootOf(body)!.classList.contains("is-loading")).toBe(true);
    gate.release();
  });

  it("2.2a removes the PNG and the loading state once the plot is drawn", async () => {
    const gate = pendingReact();
    const fake = fakePlotly(gate.react);
    const { body } = setup(fake, content(SPEC_2D));
    await until(() => fake.react.mock.calls.length >= 1);
    gate.release();
    await until(() => imgOf(body) === null);
    expect(rootOf(body)!.classList.contains("is-loading")).toBe(false);
  });

  it("2.2a gives a 3D spec's plot root the is-3d class and a 2D spec's none", async () => {
    const fake = fakePlotly();
    const three = setup(fake, content(SPEC_3D));
    const two = setup(fake, content(SPEC_2D));
    expect(rootOf(three.body)!.classList.contains("is-3d")).toBe(true);
    expect(rootOf(two.body)!.classList.contains("is-3d")).toBe(false);
  });

  it("2.2a draws a spec that has no PNG without an img", async () => {
    const fake = fakePlotly();
    const { body, expand } = setup(fake, content(SPEC_2D, null));
    await until(() => fake.react.mock.calls.length >= 1);
    expect(body.querySelector("img")).toBeNull();
    expect(Array.from(body.children)).toEqual([rootOf(body), expand]);
  });

  it("2.2a exposes the spec and the label of the plot it was given", () => {
    const fake = fakePlotly();
    const { handle } = setup(fake, content(SPEC_2D));
    expect(handle.spec).toEqual(SPEC_2D);
    expect(handle.label).toBe("Sine wave");
    expect(handle.failed).toBe(false);
  });

  it("2.2d labels a plot with the image alt when the spec has no title", () => {
    expect(setup(fakePlotly(), content(SPEC_UNTITLED)).handle.label).toBe("Python plot");
  });

  it("2.2d labels a plot Plot when there is neither a title nor an image", () => {
    expect(setup(fakePlotly(), content(SPEC_UNTITLED, null)).handle.label).toBe("Plot");
  });
});

describe("2.2 renderOutputPlot when the plot cannot be drawn", () => {
  it("2.2b keeps the PNG, removes the plot root and reports failed when the loader fails", async () => {
    const fake = failingLoader();
    const { body, handle } = setup(fake, content(SPEC_2D));
    await until(() => handle.failed);
    expect(rootOf(body)).toBeNull();
    expect(imgOf(body)!.src).toBe(SRC);
    expect(body.querySelector(".qmd-plot-error")).toBeNull();
  });

  it("2.2b keeps the PNG and removes the plot root when react rejects", async () => {
    const fake = fakePlotly(async () => { throw new Error("bad figure"); });
    const { body, handle } = setup(fake, content(SPEC_2D));
    await until(() => handle.failed);
    expect(rootOf(body)).toBeNull();
    expect(imgOf(body)).not.toBeNull();
  });

  it("2.2b shows the error line before the expand button when a spec without a PNG cannot be drawn", async () => {
    const fake = failingLoader();
    const { body, expand, handle } = setup(fake, content(SPEC_2D, null));
    await until(() => handle.failed);
    const error = body.querySelector(".qmd-plot-error")!;
    expect(error.textContent).toBe("The plot could not be drawn.");
    expect(rootOf(body)).toBeNull();
    expect(body.querySelector("img")).toBeNull();
    expect(error.nextElementSibling).toBe(expand);
  });

  it("2.2b does not report failed while the plot is still being drawn", async () => {
    const gate = pendingReact();
    const { handle } = setup(fakePlotly(gate.react), content(SPEC_2D));
    await settle(20);
    expect(handle.failed).toBe(false);
    gate.release();
  });
});

describe("2.2 OutputPlot.update redraws in place", () => {
  it("2.2c keeps the same plot root and calls react on it again", async () => {
    const fake = fakePlotly();
    const { body, handle } = setup(fake, content(SPEC_2D));
    await until(() => imgOf(body) === null);
    const root = rootOf(body)!;
    handle.update(content(SPEC_2D_B));
    await until(() => fake.react.mock.calls.length >= 2);
    expect(rootOf(body)).toBe(root);
    expect(fake.react.mock.calls[1]![0]).toBe(root);
    expect(JSON.stringify(fake.react.mock.calls[1]![1])).not.toBe(JSON.stringify(fake.react.mock.calls[0]![1]));
  });

  it("2.2c neither purges nor reloads Plotly nor replaces the body's children", async () => {
    const fake = fakePlotly();
    const { body, handle } = setup(fake, content(SPEC_2D));
    await until(() => fake.react.mock.calls.length >= 1);
    const replace = jest.spyOn(body, "replaceChildren");
    handle.update(content(SPEC_2D_B));
    await until(() => fake.react.mock.calls.length >= 2);
    await settle(20);
    expect(fake.purge).not.toHaveBeenCalled();
    expect(fake.loader).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
  });

  it("2.2c toggles is-3d on the same root and keeps the expand button", async () => {
    const fake = fakePlotly();
    const { body, expand, handle } = setup(fake, content(SPEC_2D));
    await until(() => fake.react.mock.calls.length >= 1);
    const root = rootOf(body)!;
    handle.update(content(SPEC_3D));
    await until(() => fake.react.mock.calls.length >= 2);
    expect(root.classList.contains("is-3d")).toBe(true);
    expect(expand.parentElement).toBe(body);
    handle.update(content(SPEC_2D));
    await until(() => fake.react.mock.calls.length >= 3);
    expect(root.classList.contains("is-3d")).toBe(false);
  });

  it("2.2c removes a PNG that was still waiting once the update has been drawn", async () => {
    const gate = pendingReact();
    const fake = fakePlotly(gate.react);
    const { body, handle } = setup(fake, content(SPEC_2D));
    await until(() => fake.react.mock.calls.length >= 1);
    handle.update(content(SPEC_2D_B));
    expect(imgOf(body)).not.toBeNull();
    gate.release();
    await until(() => imgOf(body) === null);
    expect(rootOf(body)).not.toBeNull();
  });

  it("2.2c makes spec and label follow the latest plot given", async () => {
    const fake = fakePlotly();
    const { handle } = setup(fake, content(SPEC_2D));
    await until(() => fake.react.mock.calls.length >= 1);
    handle.update(content(SPEC_2D_B));
    expect(handle.spec).toEqual(SPEC_2D_B);
    expect(handle.label).toBe("Cosine wave");
    handle.update(content(SPEC_UNTITLED, null));
    expect(handle.spec).toEqual(SPEC_UNTITLED);
    expect(handle.label).toBe("Plot");
  });
});

describe("2.2 OutputPlot.destroy and the plot root's drag", () => {
  it("2.2f destroy purges the plot root", async () => {
    const fake = fakePlotly();
    const { body, handle } = setup(fake, content(SPEC_2D));
    await until(() => fake.react.mock.calls.length >= 1);
    await settle(20);
    const root = rootOf(body)!;
    handle.destroy();
    expect(fake.purge).toHaveBeenCalledTimes(1);
    expect(fake.purge.mock.calls[0]![0]).toBe(root);
  });

  it("2.2f destroy is idempotent", async () => {
    const fake = fakePlotly();
    const { handle } = setup(fake, content(SPEC_2D));
    await until(() => fake.react.mock.calls.length >= 1);
    await settle(20);
    handle.destroy();
    handle.destroy();
    expect(fake.purge).toHaveBeenCalledTimes(1);
  });

  it("2.2e default-prevents a dragstart on the plot root", () => {
    const { body } = setup(fakePlotly(), content(SPEC_2D));
    const inner = document.createElement("span");
    rootOf(body)!.append(inner);
    expect(inner.dispatchEvent(new Event("dragstart", { bubbles: true, cancelable: true }))).toBe(false);
  });

  it("2.2e leaves a dragstart on the PNG alone", () => {
    const gate = pendingReact();
    const { body } = setup(fakePlotly(gate.react), content(SPEC_2D));
    expect(imgOf(body)!.dispatchEvent(new Event("dragstart", { bubbles: true, cancelable: true }))).toBe(true);
    gate.release();
  });
});

describe("2.2 openPlotFigure opens the interactive expand overlay", () => {
  const panel = () => document.querySelector<HTMLElement>("section.qmd-plot-preview");
  const expandedRoot = () => panel()?.querySelector<HTMLElement>("div.qmd-output-plot.qmd-plot-expanded") ?? null;
  const open = async (fake: Fake, spec: PlotSpec = SPEC_2D, label = "Sine wave") => {
    const close = openPlotFigure(spec, label, fake.loader);
    await until(() => fake.react.mock.calls.length >= 1);
    await settle(20);
    return close;
  };

  it("2.2d opens a panel holding its own plot root drawn by react, with no img", async () => {
    const fake = fakePlotly();
    await open(fake);
    const expanded = expandedRoot()!;
    expect(expanded).not.toBeNull();
    expect(fake.react.mock.calls[0]![0]).toBe(expanded);
    expect(panel()!.querySelector("img")).toBeNull();
  });

  it("2.2d shows the label in the header and has a close button", async () => {
    await open(fakePlotly(), SPEC_2D, "Sine wave");
    expect(panel()!.querySelector("header")!.textContent).toContain("Sine wave");
    expect(panel()!.querySelector("button.qmd-plot-close")).not.toBeNull();
  });

  it("2.2d gives the expanded root is-3d for a 3D spec only", async () => {
    await open(fakePlotly(), SPEC_3D, "Bowl");
    expect(expandedRoot()!.classList.contains("is-3d")).toBe(true);
    document.querySelector<HTMLButtonElement>(".qmd-plot-close")!.click();
    await open(fakePlotly(), SPEC_2D);
    expect(expandedRoot()!.classList.contains("is-3d")).toBe(false);
  });

  it("2.2d purges the expanded root and closes the overlay when the close button is clicked", async () => {
    const fake = fakePlotly();
    await open(fake);
    const expanded = expandedRoot()!;
    document.querySelector<HTMLButtonElement>(".qmd-plot-close")!.click();
    expect(panel()).toBeNull();
    expect(fake.purge).toHaveBeenCalledTimes(1);
    expect(fake.purge.mock.calls[0]![0]).toBe(expanded);
  });

  it("2.2d purges the expanded root when Escape dismisses the overlay", async () => {
    const fake = fakePlotly();
    await open(fake);
    const expanded = expandedRoot()!;
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(panel()).toBeNull();
    expect(fake.purge.mock.calls.map((call) => call[0])).toContain(expanded);
  });

  it("2.2d purges the expanded root and closes the overlay through the returned close, once", async () => {
    const fake = fakePlotly();
    const close = await open(fake);
    close();
    close();
    expect(panel()).toBeNull();
    expect(fake.purge).toHaveBeenCalledTimes(1);
  });

  it("2.2d purges only the expanded root, not the inline plot, when the overlay closes", async () => {
    const fake = fakePlotly();
    const { body } = setup(fake, content(SPEC_2D));
    await until(() => fake.react.mock.calls.length >= 1);
    const inline = rootOf(body)!;
    const close = await open(fake);
    close();
    expect(fake.purge.mock.calls.map((call) => call[0])).not.toContain(inline);
    expect(rootOf(body)).toBe(inline);
  });
});

describe("2.2 openPlotImage opens the PNG overlay", () => {
  it("2.2f opens a panel with the img and its alt as the header label", () => {
    openPlotImage(SRC, "Python plot");
    const panel = document.querySelector<HTMLElement>("section.qmd-plot-preview")!;
    const img = panel.querySelector<HTMLImageElement>("img")!;
    expect(img.src).toBe(SRC);
    expect(img.alt).toBe("Python plot");
    expect(panel.querySelector("header")!.textContent).toContain("Python plot");
    expect(panel.querySelector(".qmd-output-plot")).toBeNull();
  });

  it("2.2f closes the overlay through the returned close and through the close button", () => {
    const close = openPlotImage(SRC, "Python plot");
    close();
    expect(document.querySelector("section.qmd-plot-preview")).toBeNull();
    openPlotImage(SRC, "Python plot");
    document.querySelector<HTMLButtonElement>(".qmd-plot-close")!.click();
    expect(document.querySelector("section.qmd-plot-preview")).toBeNull();
  });
});
