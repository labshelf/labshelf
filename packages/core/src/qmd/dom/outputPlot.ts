// Draws a stored plot output in an output body: the interactive figure over its PNG fallback, updated in place, and the expand overlays for a figure or a PNG.
import { mountOverlay, renderElement, showMenu, type MenuEntry } from "../../ui/dom/index.js";
import { renderIcon, type IconName } from "../../ui/icons/index.js";
import type { OutputImage } from "../item/index.js";
import type { PlotSpec } from "../item/index.js";
import { attachPlotNavigation, type PlotNavigation } from "./plotNavigation.js";
import { renderPlot, type PlotHandle } from "./plotRender.js";
import type { PlotlyLoader, PlotSurfaceColour, PlotSurfaceStyle } from "./plotView.js";

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

/** A quiet icon button of the plot's own toolbar (in place of Plotly's modebar); the title adds its key. */
function plotTool(label: string, icon: IconName, key: string | null, run: () => void): HTMLButtonElement {
  const title = key ? `${label} (${key})` : label;
  const button = renderElement("button", { class: "qmd-plot-tool", type: "button", "aria-label": label, title, html: renderIcon(icon) });
  button.addEventListener("click", run);
  return button;
}

const quietly = (work: Promise<void>): void => { work.catch(() => undefined); };

interface PlotTools {
  /** The row's buttons in order: Reset view, Zoom in, Zoom out, Download PNG, `expand` (hidden, reached through More), More. */
  readonly buttons: HTMLElement[];
  /** Drops every button but `expand`, then shown, once the plot cannot be drawn. */
  fail(): void;
}

/** The More menu's drag modes: Box zoom (2D) or Orbit (3D) and Pan, a radio group whose unchecked state is the default drag. */
function modeEntries(handle: PlotHandle, nav: PlotNavigation): MenuEntry[] {
  const three = handle.dim === 3;
  return [
    three
      ? { label: "Orbit", hint: "O", radio: true, checked: nav.mode === "orbit", onSelect: () => nav.toggleAlternate() }
      : { label: "Box zoom", hint: "B", radio: true, checked: nav.mode === "zoom", onSelect: () => nav.toggleAlternate() },
    { label: "Pan", hint: "P", radio: true, checked: nav.mode === "pan", onSelect: () => nav.togglePan() },
  ];
}

/**
 * The More menu's surface groups for a 3D plot with surfaces: the style (Surface, Wireframe, Surface + wireframe; the two with
 * lines disabled when it has too many edges) and the colour (Single, By height).
 */
function surfaceEntries(handle: PlotHandle): MenuEntry[][] {
  if (!handle.hasSurfaces) return [];
  const fits = handle.wireframeFits;
  const shown = fits ? handle.surfaceStyle : "surface";
  const style = (label: string, value: PlotSurfaceStyle): MenuEntry => ({
    label, hint: "W", radio: true, checked: shown === value, disabled: value !== "surface" && !fits,
    onSelect: () => quietly(handle.setSurfaceStyle(value)),
  });
  const colour = (label: string, value: PlotSurfaceColour): MenuEntry => ({
    label, hint: "H", radio: true, checked: handle.surfaceColour === value, onSelect: () => quietly(handle.setSurfaceColour(value)),
  });
  return [
    [style("Surface", "surface"), style("Wireframe", "wireframe"), style("Surface + wireframe", "both")],
    [colour("Colour: Single", "single"), colour("Colour: By height", "height")],
  ];
}

/** Joins menu groups with separators, skipping empty ones. */
function menuGroups(...groups: MenuEntry[][]): MenuEntry[] {
  const entries: MenuEntry[] = [];
  for (const group of groups) {
    if (group.length === 0) continue;
    if (entries.length > 0) entries.push("separator");
    entries.push(...group);
  }
  return entries;
}

/**
 * The plot's buttons: Reset view, Zoom in and out, Download PNG and More. More holds the drag modes (Box zoom or Orbit, Pan),
 * the 3D surface style (Surface, Wireframe, Surface + wireframe) and colour (Single, By height), Autoscale (2D) and, given `expand`, Expand; their keys still work.
 */
function plotTools(handle: PlotHandle, nav: PlotNavigation, label: () => string, expand: HTMLElement | null): PlotTools {
  const reset = plotTool("Reset view", "discard", "0", () => nav.resetView());
  const zoomIn = plotTool("Zoom in", "add", "+", () => nav.zoom("in"));
  const zoomOut = plotTool("Zoom out", "remove", "\u2212", () => nav.zoom("out"));
  const download = plotTool("Download PNG", "device-camera", null, () => quietly(handle.downloadPng(label())));
  const more = plotTool("More plot actions", "ellipsis", null, () => {
    const actions: MenuEntry[] = [];
    if (handle.dim === 2) actions.push({ label: "Autoscale", icon: "screen-full", hint: "A", onSelect: () => nav.autoscale() });
    if (expand) actions.push({ label: "Expand", icon: "external", onSelect: () => expand.click() });
    more.setAttribute("aria-expanded", "true");
    showMenu(more, menuGroups(modeEntries(handle, nav), ...surfaceEntries(handle), actions), { onClose: () => more.setAttribute("aria-expanded", "false") });
  });
  more.setAttribute("aria-haspopup", "menu");
  more.setAttribute("aria-expanded", "false");
  if (expand) expand.hidden = true;
  const buttons: HTMLElement[] = [reset, zoomIn, zoomOut, download, ...(expand ? [expand] : []), more];
  return {
    buttons,
    fail: () => {
      for (const button of buttons) if (button !== expand) button.remove();
      if (expand) expand.hidden = false;
    },
  };
}

/** The plot root's label: what it shows and the keys that move it. */
function rootLabel(label: string, dim: 2 | 3): string {
  return `${label}, interactive: arrows ${dim === 3 ? "rotate" : "pan"}, + and \u2212 zoom, 0 resets`;
}

/** A focusable plot root that a drag inside moves the figure instead of the output. */
function plotRoot(className: string, dim: 2 | 3, label: string): HTMLElement {
  const root = renderElement("div", { class: className, tabindex: "0", role: "application", "aria-label": rootLabel(label, dim) });
  root.classList.toggle("is-3d", dim === 3);
  root.addEventListener("dragstart", (event) => event.preventDefault());
  // A native drag starts on the draggable output, not on the root, so the output stops being draggable while a press inside the root lasts.
  root.addEventListener("pointerdown", () => {
    const draggable = root.parentElement?.closest<HTMLElement>("[draggable='true']");
    if (!draggable) { return; }
    draggable.setAttribute("draggable", "false");
    const win = root.ownerDocument.defaultView ?? window;
    const restore = (): void => {
      draggable.setAttribute("draggable", "true");
      win.removeEventListener("pointerup", restore, true);
      win.removeEventListener("pointercancel", restore, true);
    };
    win.addEventListener("pointerup", restore, true);
    win.addEventListener("pointercancel", restore, true);
  }, true);
  return root;
}

/** Fills `body` with the plot's PNG (when it has one), its plot root and its button row ending in `expand`, draws the spec, and returns the handle that updates and destroys it. */
export function renderOutputPlot(body: HTMLElement, plot: OutputPlotContent, expand: HTMLElement, loadPlotly: PlotlyLoader, styleKey?: string): OutputPlot {
  let current = plot;
  let failed = false;
  let destroyed = false;
  let img: HTMLImageElement | null = plot.image
    ? renderElement("img", { class: "qmd-output-image", src: plot.image.src, alt: plot.image.alt, draggable: "false" }) : null;
  const root = plotRoot("qmd-output-plot is-loading", plot.spec.dim, plotLabel(plot));
  const handle: PlotHandle = renderPlot(root, plot.spec, loadPlotly, { styleKey });
  const nav = attachPlotNavigation(root, handle, { zone: body });
  const tools = plotTools(handle, nav, () => plotLabel(current), expand);
  const row = renderElement("div", { class: "qmd-plot-tools" }, ...tools.buttons);
  body.replaceChildren(...(img ? [img, root, row] : [root, row]));

  const showDrawn = (): void => {
    if (destroyed || failed) return;
    img?.remove();
    img = null;
    root.classList.remove("is-loading");
    nav.syncDim();
  };
  handle.drawn.then(showDrawn, () => {
    if (destroyed) return;
    failed = true;
    nav.destroy();
    root.remove();
    tools.fail();
    if (!img) row.before(renderElement("div", { class: "qmd-plot-error" }, ERROR_TEXT));
  });

  return {
    get spec() { return current.spec; },
    get label() { return plotLabel(current); },
    get failed() { return failed; },
    update(next: OutputPlotContent): void {
      current = next;
      if (destroyed || failed) return;
      root.classList.toggle("is-3d", next.spec.dim === 3);
      root.setAttribute("aria-label", rootLabel(plotLabel(next), next.spec.dim));
      handle.update(next.spec).then(showDrawn, () => undefined);
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      nav.destroy();
      handle.destroy();
    },
  };
}

/** Mounts the overlay panel (header label, `tools`, close button, then `content`) and returns its close; `onClose` runs once however it closes. */
function openPanel(label: string, ariaLabel: string, content: HTMLElement, onClose: () => void, tools: HTMLElement[] = []): () => void {
  const close = renderElement("button", { class: "qmd-plot-close", type: "button", "aria-label": "Close plot", title: "Close plot", html: renderIcon("x") });
  const group = tools.length > 0 ? [renderElement("div", { class: "qmd-plot-header-tools" }, ...tools)] : [];
  const actions = renderElement("div", { class: "qmd-plot-header-actions" }, ...group, close);
  const panel = renderElement("section", { class: "qmd-plot-preview", role: "dialog", "aria-modal": "true", "aria-label": ariaLabel },
    renderElement("header", { class: "qmd-plot-header" }, renderElement("span", {}, label), actions), content);
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

/**
 * Opens a plot spec as an interactive figure in the expand overlay, drawn by its own handle that closing destroys; the figure is
 * active while open. `styleKey` shares the surface style with the inline plot it expands.
 */
export function openPlotFigure(spec: PlotSpec, label: string, loadPlotly: PlotlyLoader, styleKey?: string): () => void {
  const root = plotRoot("qmd-output-plot qmd-plot-expanded", spec.dim, label);
  const handle = renderPlot(root, spec, loadPlotly, { styleKey });
  const nav = attachPlotNavigation(root, handle, { zone: root, alwaysActive: true });
  const tools = plotTools(handle, nav, () => label, null);
  handle.drawn.catch(() => {
    nav.destroy();
    tools.fail();
    root.replaceWith(renderElement("div", { class: "qmd-plot-error" }, ERROR_TEXT));
  });
  return openPanel(label, "Interactive plot", root, () => { nav.destroy(); handle.destroy(); }, tools.buttons);
}
