// The wheel of a plot: pinch and Ctrl/Cmd+wheel zoom about the cursor, a two-finger scroll pans while the plot is active, and
// the hint that tells a note's reader how to wake the plot when a scroll passes over it.
import { renderElement } from "../../ui/dom/index.js";
import type { PlotHandle } from "./plotRender.js";
import { panPlotView, plotPointAt, readPlotArea, readPlotView, zoomPlotView } from "./plotViewState.js";
import { requestFrameOf, type ViewDriver } from "./plotViewDriver.js";

/** A wheel delta becomes a zoom factor of exp(delta * rate); a trackpad pinch sends small deltas, so it gets the faster rate. */
const WHEEL_RATE = 0.002;
const PINCH_RATE = 0.01;
const PINCH_DELTA = 50;
const MAX_WHEEL_FACTOR = 2;
const HINT_MS = 1500;
/** The px one wheel line stands for. */
const LINE_PX = 16;

function isMac(doc: Document): boolean {
  const nav = doc.defaultView?.navigator;
  return /Mac|iPhone|iPad/.test(nav?.platform ?? nav?.userAgent ?? "");
}

/** The wheel's deltas in px, whatever unit the device reports. */
function wheelPx(event: WheelEvent, page: number): { dx: number; dy: number } {
  const unit = event.deltaMode === 1 ? LINE_PX : event.deltaMode === 2 ? page : 1;
  return { dx: event.deltaX * unit, dy: event.deltaY * unit };
}

export class PlotWheel {
  private hint: HTMLElement | null = null;
  private hintShown = false;
  private hintTimer = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly handle: PlotHandle,
    private readonly win: Window,
    private readonly driver: ViewDriver,
    private readonly isActive: () => boolean,
  ) {}

  destroy(): void {
    this.win.clearTimeout(this.hintTimer);
  }

  readonly onWheel = (event: WheelEvent): void => {
    const zoomGesture = event.ctrlKey || event.metaKey;
    if (!zoomGesture && !this.isActive()) {
      this.showHint();
      return;
    }
    const start = this.driver.wheelBase();
    if (!start) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = this.root.getBoundingClientRect();
    const { dx, dy } = wheelPx(event, rect.height || 400);
    if (start.dim === 2 && !zoomGesture && !event.shiftKey) {
      const area = readPlotArea(this.root);
      if (!area) return;
      this.driver.setTarget(panPlotView(start, dx / area.width, -dy / area.height));
      return;
    }
    // Shift turns a vertical wheel into a horizontal one on some systems.
    const amount = dy !== 0 ? dy : dx;
    const rate = zoomGesture && Math.abs(amount) < PINCH_DELTA ? PINCH_RATE : WHEEL_RATE;
    const factor = Math.min(MAX_WHEEL_FACTOR, Math.max(1 / MAX_WHEEL_FACTOR, Math.exp(amount * rate)));
    const area = start.dim === 2 ? readPlotArea(this.root) : null;
    const anchor = area ? plotPointAt(start, area, event.clientX - rect.left, event.clientY - rect.top) : null;
    this.driver.setTarget(zoomPlotView(start, factor, anchor));
  };

  private showHint(): void {
    const root = this.root;
    if (this.hintShown || readPlotView(root, this.handle.dim) === null) return;
    this.hintShown = true;
    const zoomKey = isMac(root.ownerDocument) ? "⌘" : "Ctrl";
    const hint = renderElement("div", { class: "qmd-plot-hint", "aria-hidden": "true" }, `Pinch or ${zoomKey}-scroll to zoom · click to pan with scroll`);
    this.hint = hint;
    root.append(hint);
    requestFrameOf(this.win, () => this.hint?.classList.add("is-shown"));
    this.hintTimer = this.win.setTimeout(() => this.hint?.classList.remove("is-shown"), HINT_MS);
  }
}
