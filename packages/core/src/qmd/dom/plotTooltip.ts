// The plot's own hover card: shown for the point under the pointer in place of Plotly's hover label.
import { renderElement } from "../../ui/dom/index.js";
import type { PlotSpec } from "../item/index.js";
import type { PlotTheme } from "./plotView.js";

/** What the card reads from the plot handle's live state. */
export interface PlotTooltipSource {
  readonly root: HTMLElement;
  readonly current: PlotSpec;
  readonly lastTheme: PlotTheme | null;
}

/** One point of a Plotly hover event; `bbox` (viewport px) comes with 2D points only. */
interface HoverPoint { x?: unknown; y?: unknown; z?: unknown; curveNumber?: unknown; bbox?: { x0: number; x1: number; y0: number; y1: number } }

/** The event part of the root Plotly decorates after its first draw. */
interface PlotEvents {
  on(name: string, listener: (data: unknown) => void): void;
  removeListener?(name: string, listener: (data: unknown) => void): void;
}

/** A hover value at 4 significant digits with a true minus sign; text values as they are. */
function formatHoverValue(value: unknown): string {
  if (typeof value !== "number") return String(value ?? "");
  if (!Number.isFinite(value)) return String(value);
  return String(Number(value.toPrecision(4))).replaceAll("-", "−");
}

/** The px between the hovered point and its card. */
const TOOLTIP_GAP = 12;
/** How long an unhover waits for the next hover before the card hides, so moving between points does not flicker. */
const TOOLTIP_HIDE_MS = 80;

/** The rows of the card for `point`: the trace's dot and name when it has one or the plot has several traces, then a row per axis. */
function tooltipRows(state: PlotTooltipSource, point: HoverPoint): HTMLElement[] {
  const spec = state.current;
  const index = typeof point.curveNumber === "number" ? point.curveNumber : 0;
  const trace = spec.traces[index];
  const palette = state.lastTheme?.palette ?? [];
  const colour = trace?.color ?? palette[index % Math.max(1, palette.length)] ?? "currentColor";
  const rows: HTMLElement[] = [];
  if (trace && (spec.traces.length > 1 || trace.name !== undefined)) {
    const dot = renderElement("span", { class: "qmd-plot-tooltip-dot" });
    dot.style.setProperty("--qmd-plot-tooltip-colour", colour);
    rows.push(renderElement("div", { class: "qmd-plot-tooltip-name" }, dot, renderElement("span", {}, trace.name ?? `Trace ${index + 1}`)));
  }
  const names = spec.dim === 3 ? (["x", "y", "z"] as const) : (["x", "y"] as const);
  for (const name of names) {
    rows.push(renderElement("div", { class: "qmd-plot-tooltip-row" },
      renderElement("span", { class: "qmd-plot-tooltip-label" }, spec.axes[name]?.label ?? name),
      renderElement("span", { class: "qmd-plot-tooltip-value" }, formatHoverValue(point[name]))));
  }
  return rows;
}

/** The empty card, appended to `root`. */
function createCard(root: HTMLElement): HTMLElement {
  const card = renderElement("div", { class: "qmd-plot-tooltip", "aria-hidden": "true" });
  root.append(card);
  return card;
}

/** Puts `card` beside the point at viewport position `at`, flipping near the edges of `root`. */
function placeCard(root: HTMLElement, card: HTMLElement, at: { x: number; y: number }): void {
  const rect = root.getBoundingClientRect();
  const ax = at.x - rect.left;
  const ay = at.y - rect.top;
  const w = card.offsetWidth;
  const h = card.offsetHeight;
  let left = ax + TOOLTIP_GAP;
  if (left + w > rect.width) left = ax - TOOLTIP_GAP - w;
  let top = ay - TOOLTIP_GAP - h;
  if (top < 0) top = ay + TOOLTIP_GAP;
  left = Math.max(0, Math.min(left, rect.width - w));
  top = Math.max(0, Math.min(top, rect.height - h));
  card.style.setProperty("left", `${Math.round(left)}px`);
  card.style.setProperty("top", `${Math.round(top)}px`);
  card.classList.add("is-shown");
}

/**
 * Shows a small card for the hovered point in place of Plotly's hover label (the figure sets hoverinfo "none"): the trace's colour
 * and name when it has one or the plot has several traces, then a row per axis named by its title. The card sits beside the point
 * inside the root, flipping near the edges; it never takes pointer events and hides on unhover, leave, press, wheel and scroll.
 */
export function attachPlotTooltip(state: PlotTooltipSource): (() => void) | null {
  const root = state.root;
  const events = root as HTMLElement & Partial<PlotEvents>;
  if (typeof events.on !== "function") return null;
  const win = root.ownerDocument.defaultView ?? window;
  let card: HTMLElement | null = null;
  let hideTimer = 0;
  let pointer: { x: number; y: number } | null = null;

  const hide = (): void => {
    win.clearTimeout(hideTimer);
    card?.classList.remove("is-shown");
  };
  const show = (data: unknown): void => {
    const point = (data as { points?: HoverPoint[] } | null)?.points?.[0];
    if (!point) return;
    win.clearTimeout(hideTimer);
    const rows = tooltipRows(state, point);
    card ??= createCard(root);
    card.replaceChildren(...rows);
    const box = point.bbox;
    const at = box ? { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 } : pointer;
    if (at) placeCard(root, card, at);
  };
  const unhover = (): void => {
    win.clearTimeout(hideTimer);
    hideTimer = win.setTimeout(hide, TOOLTIP_HIDE_MS);
  };
  const onMove = (event: PointerEvent): void => { pointer = { x: event.clientX, y: event.clientY }; };
  events.on("plotly_hover", show);
  events.on("plotly_unhover", unhover);
  root.addEventListener("pointermove", onMove, true);
  root.addEventListener("pointerleave", hide);
  root.addEventListener("pointerdown", hide, true);
  root.addEventListener("wheel", hide, { capture: true, passive: true });
  win.addEventListener("scroll", hide, { capture: true, passive: true });
  return () => {
    win.clearTimeout(hideTimer);
    events.removeListener?.("plotly_hover", show);
    events.removeListener?.("plotly_unhover", unhover);
    root.removeEventListener("pointermove", onMove, true);
    root.removeEventListener("pointerleave", hide);
    root.removeEventListener("pointerdown", hide, true);
    root.removeEventListener("wheel", hide, { capture: true });
    win.removeEventListener("scroll", hide, { capture: true });
    card?.remove();
    card = null;
  };
}
