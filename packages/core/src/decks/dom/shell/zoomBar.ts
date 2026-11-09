// The shell's zoom bar: the select and hand tools, optional guides, zoom out, the zoom, zoom in, Fit and, when the surface zooms to a
// rect, Zoom to section, over any zoomable surface.
import { renderElement, renderIcon, type IconName } from "../../../ui/dom/index.js";
import type { ShellTool, ShellZoomBar, ShellZoomSurface, ShellZoomTarget } from "./types.js";

const STEPS = [10, 25, 33, 50, 67, 75, 100, 125, 150, 200, 300, 400];

function toolButton(icon: IconName, label: string, title: string, run: () => void): HTMLButtonElement {
  const button = renderElement("button", { type: "button", class: "dw-tool", title, "aria-label": label, html: renderIcon(icon) });
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", run);
  return button;
}

/** `tools: false` leaves out Select and Hand (a click always picks, and the page pans by scrolling or holding Space). */
export function createZoomBar(surface: ShellZoomSurface, options: { guides?: { on(): boolean; toggle(): void }; section?: ShellZoomTarget; tools?: boolean } = {}): ShellZoomBar {
  let current: ShellTool = "select";
  const label = renderElement("span", { class: "dw-zoom-label" });
  const render = (): void => {
    const n = Math.round(surface.percent());
    label.textContent = surface.isFit() ? `Fit · ${n}%` : `${n}%`;
    if (guides) guides.setAttribute("aria-pressed", String(options.guides!.on()));
    if (section) section.disabled = !options.section?.enabled();
  };
  const zoom = (next: number | "fit"): void => { surface.setZoom(next); render(); };
  const zoomIn = (): void => { const at = surface.percent(); zoom(STEPS.find((z) => z > at) ?? STEPS[STEPS.length - 1]!); };
  const zoomOut = (): void => { const at = surface.percent(); zoom([...STEPS].reverse().find((z) => z < at) ?? STEPS[0]!); };
  const fit = (): void => zoom("fit");
  const setTool = (next: ShellTool): void => {
    current = next;
    select.setAttribute("aria-pressed", String(next === "select"));
    hand.setAttribute("aria-pressed", String(next === "hand"));
    surface.setTool(next);
  };
  const select = toolButton("target", "Select", "Select (V)", () => setTool("select"));
  const hand = toolButton("move", "Hand", "Hand (H, or hold Space)", () => setTool("hand"));
  const guides = options.guides ? toolButton("grid", "Guides", "Guides", () => { options.guides!.toggle(); render(); }) : undefined;
  const fitButton = renderElement("button", { type: "button", class: "dw-zoom-fit", text: "Fit", title: "Fit the page", "aria-label": "Fit" });
  fitButton.addEventListener("mousedown", (event) => event.preventDefault());
  fitButton.addEventListener("click", fit);
  const section = surface.zoomToRect ? toolButton("zoom-in", "Zoom to section", "Zoom to section (Z)", () => { if (options.section?.enabled()) { options.section.run(); render(); } }) : undefined;
  const element = renderElement("div", { class: "dw-zoombar", role: "toolbar", "aria-label": "Zoom" },
    ...(options.tools === false ? [] : [select, hand]), ...(guides ? [guides] : []), ...(options.tools === false && !guides ? [] : [renderElement("span", { class: "dw-zoombar-rule" })]),
    toolButton("minus", "Zoom out", "Zoom out", zoomOut), label, toolButton("plus", "Zoom in", "Zoom in", zoomIn), fitButton, ...(section ? [section] : []));
  select.setAttribute("aria-pressed", "true");
  hand.setAttribute("aria-pressed", "false");
  render();
  return { element, render, zoomIn, zoomOut, fit, tool: () => current, setTool };
}
