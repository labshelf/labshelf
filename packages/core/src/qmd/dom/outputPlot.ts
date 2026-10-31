// Draws a stored plot output in an output body: the interactive figure over its PNG fallback, updated in place, and the expand overlays for a figure or a PNG.
import { mountOverlay, renderElement } from "../../ui/dom/index.js";
import { renderIcon } from "../../ui/icons/index.js";
import type { OutputImage } from "../item/index.js";
import type { PlotSpec } from "../plot/index.js";
import { renderPlot, type PlotHandle, type PlotlyLoader } from "./plotView.js";

export interface OutputPlotContent { image: OutputImage | null; spec: PlotSpec }

export interface OutputPlot {
  readonly spec: PlotSpec;
  readonly label: string;
  /** True once the plot could not be drawn; the view then redraws from scratch on its next content. */
  readonly failed: boolean;
  update(plot: OutputPlotContent): void;
  destroy(): void;
}

const ERROR_TEXT = "The plot could not be drawn.";

function plotLabel(plot: OutputPlotContent): string {
  return plot.spec.title ?? plot.image?.alt ?? "Plot";
}

/** Fills `body` with the plot's PNG (when it has one), its plot root and `expand`, draws the spec, and returns the handle that updates and destroys it. */
export function renderOutputPlot(body: HTMLElement, plot: OutputPlotContent, expand: HTMLElement, loadPlotly: PlotlyLoader): OutputPlot {
  let current = plot;
  let failed = false;
  let destroyed = false;
  let img: HTMLImageElement | null = plot.image
    ? renderElement("img", { class: "qmd-output-image", src: plot.image.src, alt: plot.image.alt, draggable: "false" }) : null;
  const root = renderElement("div", { class: "qmd-output-plot is-loading" });
  root.classList.toggle("is-3d", plot.spec.dim === 3);
  // A drag inside the figure zooms, pans or rotates it instead of moving the output.
  root.addEventListener("dragstart", (event) => event.preventDefault());
  body.replaceChildren(...(img ? [img, root, expand] : [root, expand]));
  const handle: PlotHandle = renderPlot(root, plot.spec, loadPlotly);

  const showDrawn = (): void => {
    if (destroyed || failed) return;
    img?.remove();
    img = null;
    root.classList.remove("is-loading");
  };
  handle.drawn.then(showDrawn, () => {
    if (destroyed) return;
    failed = true;
    root.remove();
    if (!img) expand.before(renderElement("div", { class: "qmd-plot-error" }, ERROR_TEXT));
  });

  return {
    get spec() { return current.spec; },
    get label() { return plotLabel(current); },
    get failed() { return failed; },
    update(next: OutputPlotContent): void {
      current = next;
      if (destroyed || failed) return;
      root.classList.toggle("is-3d", next.spec.dim === 3);
      handle.update(next.spec).then(showDrawn, () => undefined);
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      handle.destroy();
    },
  };
}

/** Mounts the overlay panel (header label, close button, then `content`) and returns its close; `onClose` runs once however it closes. */
function openPanel(label: string, ariaLabel: string, content: HTMLElement, onClose: () => void): () => void {
  const close = renderElement("button", { class: "qmd-plot-close", type: "button", "aria-label": "Close plot", html: renderIcon("x") });
  const panel = renderElement("section", { class: "qmd-plot-preview", role: "dialog", "aria-modal": "true", "aria-label": ariaLabel },
    renderElement("header", { class: "qmd-plot-header" }, renderElement("span", {}, label), close), content);
  let closed = false;
  const finish = (): void => {
    if (closed) return;
    closed = true;
    onClose();
  };
  const overlay = mountOverlay(panel, finish);
  const shut = (): void => { finish(); overlay.close(); };
  close.addEventListener("click", shut);
  close.focus();
  return shut;
}

/** Opens a stored PNG in the expand overlay. */
export function openPlotImage(src: string, alt: string): () => void {
  return openPanel(alt, "Python plot", renderElement("img", { src, alt }), () => undefined);
}

/** Opens a plot spec as an interactive figure in the expand overlay, drawn by its own handle that closing destroys. */
export function openPlotFigure(spec: PlotSpec, label: string, loadPlotly: PlotlyLoader): () => void {
  const root = renderElement("div", { class: "qmd-output-plot qmd-plot-expanded" });
  root.classList.toggle("is-3d", spec.dim === 3);
  root.addEventListener("dragstart", (event) => event.preventDefault());
  const handle = renderPlot(root, spec, loadPlotly);
  handle.drawn.catch(() => root.replaceWith(renderElement("div", { class: "qmd-plot-error" }, ERROR_TEXT)));
  return openPanel(label, "Interactive plot", root, () => handle.destroy());
}
