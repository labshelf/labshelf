// Holds the pure navigation logic: action dedupe, find-scroll maths, view history and zoom.

// Detects a keyboard chord delivered twice, once by the webview keydown and once by a host command message.
// INVARIANT: only a repeat from the other source is a duplicate; same-source repeats (held key, palette) all run.

export type ActionSource = "key" | "host";

export interface ActionStamp {
  action: string;
  source: ActionSource;
  at: number;
}

// Round trip webview → host keybinding resolution → extension host → webview; generous because it crosses two processes.
export const CROSS_SOURCE_WINDOW_MS = 250;

/**
 * @returns true when `next` is the same chord arriving a second time through the other route.
 */
export function isDuplicateDelivery(last: ActionStamp | null, next: ActionStamp): boolean {
  if (!last) { return false; }
  return last.action === next.action
    && last.source !== next.source
    && next.at - last.at >= 0
    && next.at - last.at < CROSS_SOURCE_WINDOW_MS;
}

// Computes where a find hit should sit on screen.
// PLATFORM: pdf.js scrolls a hit to 50px below the container top, under the overlay toolbar and find bar, even when the next hit is in view.

/** Toolbar + find bar + breathing room, in CSS px. */
export const FIND_OVERLAY_PX = 110;
const BOTTOM_MARGIN_PX = 64;
const TARGET_RATIO = 0.3;

export interface MatchBox {
  /** Hit edges relative to the container's top edge, as they were when the find command was issued (before pdf.js scrolled anything). */
  top: number;
  bottom: number;
}

/** A scroll position remembered at find time is only trusted this long; a late text-layer render must not yank the reader back. */
export const FIND_ORIGIN_TTL_MS = 3000;

export interface FindOrigin {
  top: number;
  left: number;
  at: number;
}

/**
 * @returns the origin if it is still fresh, else null.
 */
export function deriveFreshOrigin(origin: FindOrigin | null, now: number): FindOrigin | null {
  return origin && now - origin.at <= FIND_ORIGIN_TTL_MS ? origin : null;
}

export type FindScrollOutcome =
  | { kind: "stay" }
  | { kind: "place"; top: number };

/**
 * @returns "stay" when the hit was already comfortably readable (stepping through hits on one screen should not move the page), otherwise the offset from the container top at which to place the hit.
 */
export function deriveMatchScroll(before: MatchBox | null, containerHeight: number): FindScrollOutcome {
  // Without a known starting position there is nothing to stay at.
  const comfortable = before !== null
    && before.top >= FIND_OVERLAY_PX
    && before.bottom <= containerHeight - BOTTOM_MARGIN_PX;
  if (comfortable) { return { kind: "stay" }; }
  return { kind: "place", top: Math.max(FIND_OVERLAY_PX, Math.round(containerHeight * TARGET_RATIO)) };
}

// Keeps a browser-style back/forward stack of reading positions.
// PLATFORM: pdf.js' PDFHistory rides on window.history and the URL hash, neither usable inside a VS Code webview.

export interface ViewPosition {
  pageNumber: number;
  /** pdf.js location space (PDF points). */
  left?: number;
  top?: number;
  scaleValue?: string;
}

export const HISTORY_CAP = 50;
// Two positions closer than this on the same page are one place to a reader.
const NEAR_POINTS = 120;

/**
 * @returns true when both locations are on the same page and close enough to count as one place.
 */
function isNearLocation(a: ViewPosition, b: ViewPosition): boolean {
  if (a.pageNumber !== b.pageNumber) { return false; }
  return Math.abs((a.top ?? 0) - (b.top ?? 0)) < NEAR_POINTS;
}

/**
 * The stack stores departure points. `visit(from)` is called right before a jump; `back(current)` swaps the current position onto the forward side so the round trip is lossless.
 */
export class HistoryStack {
  private backStack: ViewPosition[] = [];
  private forwardStack: ViewPosition[] = [];

  /**
   * Records the position being left by a jump; any forward branch is discarded, as in a browser.
   */
  visit(from: ViewPosition): void {
    this.forwardStack = [];
    const last = this.backStack[this.backStack.length - 1];
    if (last && isNearLocation(last, from)) { return; }
    this.backStack.push(from);
    if (this.backStack.length > HISTORY_CAP) { this.backStack.shift(); }
  }

  /**
   * Pops the most recent departure point and pushes `current` onto the forward stack so the trip can be replayed.
   * @returns the location to jump to, or null when the back stack is empty.
   */
  back(current: ViewPosition): ViewPosition | null {
    const target = this.backStack.pop();
    if (!target) { return null; }
    this.forwardStack.push(current);
    return target;
  }

  /**
   * Pops the most recent forward target and pushes `current` back onto the back stack.
   * @returns the location to jump to, or null when the forward stack is empty.
   */
  forward(current: ViewPosition): ViewPosition | null {
    const target = this.forwardStack.pop();
    if (!target) { return null; }
    this.backStack.push(current);
    return target;
  }

  get canGoBack(): boolean { return this.backStack.length > 0; }
  get canGoForward(): boolean { return this.forwardStack.length > 0; }

  /**
   * Empties both the back and forward stacks.
   */
  clear(): void {
    this.backStack = [];
    this.forwardStack = [];
  }
}

// Computes the reader's zoom: scale clamping, button steps, wheel/pinch deltas and the cursor-anchored origin pdf.js expects.

// Beyond 8x a HiDPI page canvas costs hundreds of megapixels even with pdf.js' detail canvas.
export const MIN_SCALE = 0.25;
export const MAX_SCALE = 8;

const ZOOM_STEPS: readonly number[] = [
  0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6, 8,
];

const PRESETS = new Set(["page-width", "page-fit", "page-actual", "auto"]);

/**
 * @returns the scale limited to [MIN_SCALE, MAX_SCALE]; 1 for a non-finite input.
 */
export function deriveClampedScale(scale: number): number {
  if (!Number.isFinite(scale)) { return 1; }
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * True for the pdf.js scale values that depend on the container size and so must be re-applied on resize.
 * @returns whether `value` is one of the preset scale names rather than a numeric zoom.
 */
export function isPresetScale(value: string | null | undefined): boolean {
  return typeof value === "string" && PRESETS.has(value);
}

/**
 * Next rung of the zoom ladder for the +/- buttons and keys.
 * @returns the neighbouring step, or the clamped current scale at either end.
 */
export function deriveNextZoomStep(current: number, direction: 1 | -1): number {
  const eps = 0.005;
  if (direction > 0) {
    return ZOOM_STEPS.find((s) => s > current + eps) ?? MAX_SCALE;
  }
  return [...ZOOM_STEPS].reverse().find((s) => s < current - eps) ?? MIN_SCALE;
}

const DOM_DELTA_PIXEL = 0;
const WHEEL_NOTCH_PX = 50;

/**
 * Converts one ctrl/cmd+wheel event into a multiplicative scale factor.
 * Trackpad pinches arrive as many small pixel deltas and map smoothly; mouse wheels arrive as coarse notches and map to 10% steps.
 * @returns a factor in [0.5, 2]; 1 means no change.
 */
export function deriveScaleFactor(deltaY: number, deltaMode: number): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) { return 1; }
  let factor: number;
  if (deltaMode !== DOM_DELTA_PIXEL || Math.abs(deltaY) >= WHEEL_NOTCH_PX) {
    const notches = deltaMode !== DOM_DELTA_PIXEL
      ? Math.max(1, Math.round(Math.abs(deltaY) / 3))
      : Math.max(1, Math.round(Math.abs(deltaY) / 100));
    factor = Math.pow(1.1, -Math.sign(deltaY) * notches);
  } else {
    factor = Math.exp(-deltaY / 100);
  }
  return Math.min(2, Math.max(0.5, factor));
}

/**
 * Limits a factor so `current * factor` stays inside [MIN_SCALE, MAX_SCALE].
 * @returns the (possibly reduced) factor; 1 when already pinned at a bound.
 */
export function deriveBoundedFactor(current: number, factor: number): number {
  if (!(current > 0)) { return 1; }
  return deriveClampedScale(current * factor) / current;
}

export interface Box {
  left: number;
  top: number;
}

/**
 * pdf.js' `updateScale({origin})` subtracts `[container.offsetLeft, container.offsetTop]`, which are relative to the offsetParent, not the viewport.
 * A raw clientX/clientY would therefore drift by the sidebar width; this rebases the pointer into that space.
 * @returns `[x, y]` to pass as `origin`.
 */
export function deriveAnchorOrigin(
  clientX: number,
  clientY: number,
  containerRect: Box,
  containerOffset: Box,
): [number, number] {
  return [
    clientX - containerRect.left + containerOffset.left,
    clientY - containerRect.top + containerOffset.top,
  ];
}

/**
 * @returns the scale as a whole percentage, e.g. "125%".
 */
export function formatZoomLabel(scale: number): string {
  return `${Math.round(deriveClampedScale(scale) * 100)}%`;
}
