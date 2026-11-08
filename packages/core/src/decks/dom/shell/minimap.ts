// The poster minimap of the shell: the page outline, its section or block boxes and the visible viewport, scaled to 160 px wide, over
// the stage's bottom-right corner; a click or drag pans the stage to the page point under the pointer. The port speaks the stage's own
// page units (pt for compiled posters, canvas px for HTML ones). Also the zoom that fits a rect into the stage, shared by Zoom to section.
import { renderElement } from "../../../ui/dom/index.js";

type Box = { left: number; top: number; width: number; height: number };

export interface MinimapPort {
  page(): { width: number; height: number } | null;
  boxes(): Box[];
  viewport(): Box | null;
  panTo(centre: { x: number; y: number }): void;
}

const WIDTH = 160;
const MIN_ZOOM = 10;
const MAX_ZOOM = 400;
/** Page units the viewport may miss the page by and still count as showing all of it. */
const SLACK = 0.5;

/** The zoom percent (10..400) fitting `rect` (px at 100%) with `padding` on each side into `view`. */
export function fitRectZoom(rect: { width: number; height: number }, view: { width: number; height: number }, padding: number): number {
  const fit = Math.min((view.width - 2 * padding) / rect.width, (view.height - 2 * padding) / rect.height);
  const zoom = Math.floor(100 * fit + 1e-9);
  return Number.isFinite(zoom) ? Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)) : MIN_ZOOM;
}

const place = (element: HTMLElement, box: Box, scale: number): void => {
  Object.assign(element.style, { position: "absolute", left: `${box.left * scale}px`, top: `${box.top * scale}px`, width: `${box.width * scale}px`, height: `${box.height * scale}px` });
};

const showsAll = (page: { width: number; height: number }, view: Box): boolean =>
  view.left <= SLACK && view.top <= SLACK && view.left + view.width >= page.width - SLACK && view.top + view.height >= page.height - SLACK;

export function createMinimap(port: MinimapPort): { element: HTMLElement; render(): void } {
  const view = renderElement("div", { class: "dsh-minimap-view" });
  Object.assign(view.style, { border: "1.5px solid var(--ls-focus)", background: "color-mix(in srgb, var(--ls-focus) 12%, transparent)", boxSizing: "border-box", pointerEvents: "none" });
  const sheet = renderElement("div", { class: "dsh-minimap" });
  Object.assign(sheet.style, { position: "relative", overflow: "hidden", cursor: "pointer", background: "var(--ls-bg)", touchAction: "none" });
  const element = renderElement("div", { class: "dsh-minimap-frame", role: "region", "aria-label": "Poster overview" }, sheet);
  Object.assign(element.style, {
    position: "absolute", right: "var(--ls-space-5)", bottom: "calc(var(--ls-space-5) + 40px)", zIndex: "3", padding: "4px",
    border: "1px solid var(--ls-border)", borderRadius: "var(--ls-radius)", background: "var(--ls-widget-bg)", boxShadow: "var(--ls-widget-shadow)",
  });
  let scale = 1;

  const render = (): void => {
    const page = port.page();
    const viewport = page ? port.viewport() : null;
    if (!page || !viewport || page.width <= 0 || page.height <= 0 || showsAll(page, viewport)) { element.hidden = true; return; }
    element.hidden = false;
    scale = WIDTH / page.width;
    sheet.style.width = `${WIDTH}px`;
    sheet.style.height = `${page.height * scale}px`;
    const boxes = port.boxes().map((box) => {
      const div = renderElement("div", { class: "dsh-minimap-box" });
      Object.assign(div.style, { border: "1px solid var(--ls-border)", background: "var(--ls-widget-bg)", boxSizing: "border-box", pointerEvents: "none" });
      place(div, box, scale);
      return div;
    });
    place(view, viewport, scale);
    sheet.replaceChildren(...boxes, view);
  };

  let dragging = false;
  const pan = (event: MouseEvent): void => {
    const page = port.page();
    if (!page) return;
    const bounds = sheet.getBoundingClientRect();
    const x = Math.min(page.width, Math.max(0, (event.clientX - bounds.left) / scale));
    const y = Math.min(page.height, Math.max(0, (event.clientY - bounds.top) / scale));
    port.panTo({ x, y });
  };
  sheet.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    dragging = true;
    if (typeof event.pointerId === "number") { try { sheet.setPointerCapture?.(event.pointerId); } catch { /* the pointer is gone already */ } }
    pan(event);
  });
  sheet.addEventListener("pointermove", (event) => { if (dragging) pan(event); });
  const stop = (): void => { dragging = false; };
  sheet.addEventListener("pointerup", stop);
  sheet.addEventListener("pointercancel", stop);
  sheet.addEventListener("click", (event) => event.stopPropagation());
  render();
  return { element, render };
}
