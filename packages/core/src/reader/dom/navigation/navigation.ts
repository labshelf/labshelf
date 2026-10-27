// Moves around the reader: zoom, keyboard, back and forward history, page points and source sync.
import type { PageViewport } from "pdfjs-dist";
import { type ZoomKind, type PagePoint, deriveClampedPage } from "../../index.js";
import { createDebouncer } from "../../../async/index.js";
import {
  deriveAnchorOrigin, deriveBoundedFactor, deriveClampedScale, isPresetScale, deriveNextZoomStep, deriveScaleFactor,
  isDuplicateDelivery, type ActionSource, type ActionStamp, ACTIONS_BLOCKED_WHILE_TYPING, CHORD_TIMEOUT_MS,
  resolveShortcut, type ReaderAction, HistoryStack, type ViewPosition,
} from "../../navigation/index.js";
import { type ReaderContext, type PdfPosition, DOCUMENT_REPLACED } from "../session/index.js";
import { isTextInput, deriveClampedNumber } from "../highlights/elements.js";

// Controls the PDF zoom within the visible reader viewport.

// pdf.js CSS-scales the rendered canvases immediately and re-rasters once the gesture has been quiet this long.
const WHEEL_DRAWING_DELAY_MS = 400;
const STEP_DRAWING_DELAY_MS = 150;
const REFIT_DEBOUNCE_MS = 120;

export class Zoom {
  private pendingFactor = 1;
  private pendingOrigin: [number, number] | null = null;
  private frame: number | null = null;

  constructor(private readonly ctx: ReaderContext) {
    const { container } = ctx;
    // Chromium reports a trackpad pinch as ctrl+wheel, so this one listener covers both.
    container.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });

    // pdf.js does not refit on resize; re-apply the preset, but never touch a numeric zoom the reader chose.
    const refit = createDebouncer(() => {
      if (container.clientWidth === 0 || container.clientHeight === 0) return;
      const value = ctx.pdfViewer.currentScaleValue;
      if (isPresetScale(value)) { ctx.pdfViewer.currentScaleValue = value; }
      ctx.pdfViewer.update();
    }, REFIT_DEBOUNCE_MS);
    let lastWidth = container.clientWidth;
    let lastHeight = container.clientHeight;
    new ResizeObserver(() => {
      if (container.clientWidth === lastWidth && container.clientHeight === lastHeight) { return; }
      lastWidth = container.clientWidth;
      lastHeight = container.clientHeight;
      refit.call();
    }).observe(container);
  }

  get scale(): number { return this.ctx.pdfViewer.currentScale; }
  get scaleValue(): string { return this.ctx.pdfViewer.currentScaleValue; }

  zoomIn(): void { this.setScale(deriveNextZoomStep(this.scale, 1)); }
  zoomOut(): void { this.setScale(deriveNextZoomStep(this.scale, -1)); }

  setPreset(preset: ZoomKind): void {
    this.ctx.pdfViewer.currentScaleValue = preset;
  }

  /**
   * Steps keep the viewport centre fixed, which is what a reader expects from a button or a key.
   */
  setScale(scale: number): void {
    const target = deriveClampedScale(scale);
    const current = this.scale;
    if (!(current > 0) || Math.abs(target - current) < 1e-6) { return; }
    const rect = this.ctx.container.getBoundingClientRect();
    this.ctx.pdfViewer.updateScale({
      scaleFactor: target / current,
      drawingDelay: STEP_DRAWING_DELAY_MS,
      origin: this.origin(rect.left + rect.width / 2, rect.top + rect.height / 2),
    });
  }

  private origin(clientX: number, clientY: number): [number, number] {
    const { container } = this.ctx;
    return deriveAnchorOrigin(
      clientX,
      clientY,
      container.getBoundingClientRect(),
      { left: container.offsetLeft, top: container.offsetTop },
    );
  }

  private onWheel(e: WheelEvent): void {
    if (!e.ctrlKey && !e.metaKey) { return; }
    e.preventDefault();
    this.pendingFactor *= deriveScaleFactor(e.deltaY, e.deltaMode);
    this.pendingOrigin = this.origin(e.clientX, e.clientY);
    if (this.frame !== null) { return; }
    // A pinch fires many events per frame; one updateScale per frame keeps the gesture smooth.
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      const factor = deriveBoundedFactor(this.scale, this.pendingFactor);
      const origin = this.pendingOrigin;
      this.pendingFactor = 1;
      this.pendingOrigin = null;
      if (Math.abs(factor - 1) < 1e-4 || !origin) { return; }
      this.ctx.pdfViewer.updateScale({ scaleFactor: factor, drawingDelay: WHEEL_DRAWING_DELAY_MS, origin });
    });
  }
}

/**
 * Turns keydown events into reader actions via the pure keymap, and drives held-key scrolling with a rAF loop (key-repeat + smooth scrolling stutters).
 */

const SCROLL_PX_PER_SEC = 900;
const SCROLL_ACTIONS: Partial<Record<ReaderAction, [number, number]>> = {
  scrollDown: [0, 1],
  scrollUp: [0, -1],
  scrollLeft: [-1, 0],
  scrollRight: [1, 0],
};
const NATIVE_IN_CHROME: ReadonlySet<ReaderAction> = new Set<ReaderAction>([
  "scrollDown", "scrollUp", "scrollLeft", "scrollRight", "pageDown", "pageUp", "firstPage", "lastPage", "nextPage", "prevPage",
]);

export class Keyboard {
  private pendingPrefix: string | null = null;
  private readonly prefixExpiry = createDebouncer(() => { this.pendingPrefix = null; }, CHORD_TIMEOUT_MS);
  private held: { key: string; dir: [number, number] } | null = null;
  private frame: number | null = null;
  private lastFrameTime = 0;
  private lastRun: ActionStamp | null = null;

  constructor(private readonly ctx: ReaderContext, private readonly run: (action: ReaderAction) => void) {
    document.addEventListener("keydown", (e) => this.onKeyDown(e));
    document.addEventListener("keyup", (e) => { if (this.held?.key === e.key) { this.stopScroll(); } });
    window.addEventListener("blur", () => this.stopScroll());
  }

  /**
   * Runs an action unless it is the same chord arriving a second time through the other route (keydown vs. host keybinding).
   */
  dispatch(action: ReaderAction, source: ActionSource): void {
    // A contributed keybinding fires no matter where the focus is inside the webview; keydown already applies this rule in resolveShortcut.
    if (source === "host" && ACTIONS_BLOCKED_WHILE_TYPING.has(action) && isTextInput(document.activeElement)) { return; }
    const stamp: ActionStamp = { action, source, at: performance.now() };
    if (isDuplicateDelivery(this.lastRun, stamp)) { return; }
    this.lastRun = stamp;
    this.run(action);
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.isComposing) { return; }
    const { action, pendingPrefix } = resolveShortcut(
      { key: e.key, code: e.code, ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey, shift: e.shiftKey },
      {
        vimKeys: this.ctx.prefs.vimKeys,
        isMac: this.ctx.boot.isMac,
        inTextInput: isTextInput(e.target),
        pendingPrefix: this.pendingPrefix,
        preview: this.ctx.boot.preview,
      },
    );
    this.setPrefix(pendingPrefix);
    if (pendingPrefix !== null) { e.preventDefault(); return; }
    if (!action) { return; }
    const target = e.target instanceof HTMLElement ? e.target : null;
    // Space/Enter on a focused control activates it; scroll keys inside the sidebar or a menu scroll that list.
    const onControl = target?.closest("button, a, [role=button], [role=treeitem]") !== null && target !== null;
    if (onControl && (e.key === " " || e.key === "Enter")) { return; }
    const inChrome = target?.closest("#sidebar, .rd-popover") != null;
    if (inChrome && NATIVE_IN_CHROME.has(action)) { return; }
    // Escape must still reach inputs and native handlers when nothing of ours is open; main decides.
    if (action !== "escape") { e.preventDefault(); }

    const dir = SCROLL_ACTIONS[action];
    if (dir) {
      if (!e.repeat) { this.startScroll(e.key, dir); }
      return;
    }
    this.dispatch(action, "key");
  }

  private setPrefix(prefix: string | null): void {
    this.pendingPrefix = prefix;
    if (prefix === null) { this.prefixExpiry.cancel(); } else { this.prefixExpiry.call(); }
  }

  private startScroll(key: string, dir: [number, number]): void {
    this.held = { key, dir };
    // A tap still moves a useful amount even if the key is released before the first frame.
    this.ctx.container.scrollBy({ left: dir[0] * 40, top: dir[1] * 40 });
    if (this.frame !== null) { return; }
    this.lastFrameTime = performance.now();
    const tick = (now: number): void => {
      if (!this.held) { this.frame = null; return; }
      const dt = Math.min(64, now - this.lastFrameTime) / 1000;
      this.lastFrameTime = now;
      const [dx, dy] = this.held.dir;
      this.ctx.container.scrollBy({ left: dx * SCROLL_PX_PER_SEC * dt, top: dy * SCROLL_PX_PER_SEC * dt });
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  private stopScroll(): void {
    this.held = null;
    if (this.frame !== null) { cancelAnimationFrame(this.frame); this.frame = null; }
  }
}

/**
 * Records back/forward navigation. Installed into PDFLinkService through its duck-typed `setHistory()`, so every internal link, outline click and named destination records the place the reader left.
 */

export class NavigationHistory {
  private readonly stack = new HistoryStack();
  private location: PdfPosition | null = null;
  private readonly listeners: Array<() => void> = [];

  constructor(private readonly ctx: ReaderContext) {
    ctx.eventBus.on("updateviewarea", (evt: { location?: PdfPosition }) => {
      if (evt.location) { this.location = evt.location; }
    });
    // PDFLinkService calls pushCurrentPosition() immediately before it scrolls; push()/pushPage() carry the
    // target, which a departure-point stack does not need.
    ctx.linkService.setHistory({
      pushCurrentPosition: () => this.recordDeparture(),
      push: () => { /* target is implicit */ },
      pushPage: () => { /* target is implicit */ },
      back: () => this.back(),
      forward: () => this.forward(),
    } as unknown as Parameters<ReaderContext["linkService"]["setHistory"]>[0]);
  }

  /**
   * Registers a callback invoked whenever the back/forward availability changes.
   */
  onChange(fn: () => void): void { this.listeners.push(fn); }
  get canGoBack(): boolean { return this.stack.canGoBack; }
  get canGoForward(): boolean { return this.stack.canGoForward; }

  /**
   * Call before any programmatic jump that does not go through the link service (go-to-page, thumbnails, annotations, far find hits).
   */
  recordDeparture(): void {
    this.visit(this.current());
  }

  /**
   * Records an explicit departure point, for jumps only recognised after they happened.
   */
  visit(from: ViewPosition): void {
    this.stack.visit(from);
    this.emit();
  }

  /**
   * Jumps to the previous departure point, if any.
   */
  back(): void {
    const target = this.stack.back(this.current());
    if (target) { this.go(target); }
  }

  /**
   * Jumps to the next forward target, if any.
   */
  forward(): void {
    const target = this.stack.forward(this.current());
    if (target) { this.go(target); }
  }

  /**
   * PLATFORM: pdf.js refreshes its location one animation frame after a scroll. Two jumps inside that frame (chained commands,
   * key repeat) would record the first jump's departure point twice and lose the second; update() recomputes it on the spot.
   * @returns the reader's current view location.
   */
  current(): ViewPosition {
    this.ctx.pdfViewer.update();
    const loc = this.location;
    if (!loc) { return { pageNumber: this.ctx.pdfViewer.currentPageNumber }; }
    return { pageNumber: loc.pageNumber, left: loc.left, top: loc.top };
  }

  private go(target: ViewPosition): void {
    const destArray = target.top !== undefined
      ? [null, { name: "XYZ" }, target.left ?? null, target.top, null]
      : undefined;
    this.ctx.pdfViewer.scrollPageIntoView({
      pageNumber: target.pageNumber,
      ...(destArray ? { destArray, allowNegativeOffset: true } : {}),
    });
    this.emit();
  }

  private emit(): void {
    for (const fn of this.listeners) { fn(); }
  }
}

// Converts between the host's page points (points from the page's top-left corner, y down) and pixels inside a pdf.js page view.

/** The part of a pdf.js PageViewport the conversion needs; pdf.js handles scale and rotation in its two convert methods. */
export type PageViewportLike = Pick<PageViewport, "viewBox" | "convertToPdfPoint" | "convertToViewportPoint">;

/** The part of a pdf.js page view that marks drawn over a page need. */
export interface PageViewLike {
  div: HTMLElement;
  viewport: PageViewportLike & Pick<PageViewport, "width" | "height">;
}

/** The page point under a pixel position measured from the page element's top-left corner. */
export function derivePagePoint(page: number, viewport: PageViewportLike, offsetX: number, offsetY: number): PagePoint {
  const [pdfX = 0, pdfY = 0] = viewport.convertToPdfPoint(offsetX, offsetY);
  const [left = 0, , , top = 0] = viewport.viewBox;
  return { page, x: pdfX - left, y: top - pdfY };
}

/** The pixel position, from the page element's top-left corner, of a point; a point beyond the page's edge lands on the edge. */
export function derivePixelOffset(viewport: PageViewportLike, point: PagePoint): [number, number] {
  const [left = 0, bottom = 0, right = 0, top = 0] = viewport.viewBox;
  const x = deriveClampedNumber(point.x, 0, right - left);
  const y = deriveClampedNumber(point.y, 0, top - bottom);
  const [pixelX = 0, pixelY = 0] = viewport.convertToViewportPoint(left + x, top - y);
  return [pixelX, pixelY];
}

// Links a build preview to its source: a double-click reports the page point behind it, a revealed point is scrolled into view and marked.

// Where the revealed point lands, as a fraction of the container's height from its top.
const REVEAL_POSITION = 1 / 3;
const MARKER_MS = 1600;

interface SyncPageView {
  div: HTMLElement;
  viewport: PageViewportLike;
}

export class SourceSync {
  private marker: HTMLElement | null = null;
  private markerTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly ctx: ReaderContext) {
    ctx.eventBus.on(DOCUMENT_REPLACED, () => this.clearMarker());
    if (ctx.boot.preview) { ctx.container.addEventListener("dblclick", (event) => this.onDoubleClick(event)); }
  }

  /** Scrolls so the point sits about a third from the container's top and marks it for a moment. */
  reveal(point: PagePoint): void {
    const { container, pdfDocument, pdfViewer } = this.ctx;
    const page = deriveClampedPage(point.page, pdfDocument.numPages);
    const view = pdfViewer.getPageView(page - 1) as SyncPageView | undefined;
    if (!view?.viewport) { return; }
    const [pixelX, pixelY] = derivePixelOffset(view.viewport, point);
    const box = container.getBoundingClientRect();
    const pageBox = view.div.getBoundingClientRect();
    // Position inside the scrolled content, which the marker shares because it is a child of the container.
    const x = container.scrollLeft + pageBox.left - box.left + view.div.clientLeft + pixelX;
    const y = container.scrollTop + pageBox.top - box.top + view.div.clientTop + pixelY;
    container.scrollTop = Math.max(0, y - container.clientHeight * REVEAL_POSITION);
    if (x < container.scrollLeft || x > container.scrollLeft + container.clientWidth) {
      container.scrollLeft = Math.max(0, x - container.clientWidth / 2);
    }
    this.showMarker(x, y);
  }

  private onDoubleClick(event: MouseEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    const pageEl = target?.closest<HTMLElement>(".page");
    const page = Number(pageEl?.dataset["pageNumber"]);
    if (!pageEl || !page || target?.closest("a")) { return; }
    const view = this.ctx.pdfViewer.getPageView(page - 1) as SyncPageView | undefined;
    if (!view?.viewport) { return; }
    const box = pageEl.getBoundingClientRect();
    const point = derivePagePoint(page, view.viewport, event.clientX - box.left - pageEl.clientLeft, event.clientY - box.top - pageEl.clientTop);
    this.ctx.host.post({ command: "showSource", point });
  }

  private showMarker(x: number, y: number): void {
    this.clearMarker();
    const marker = document.createElement("div");
    marker.className = "rd-sync-marker";
    marker.style.left = `${x}px`;
    marker.style.top = `${y}px`;
    this.ctx.container.appendChild(marker);
    this.marker = marker;
    this.markerTimer = setTimeout(() => this.clearMarker(), MARKER_MS);
  }

  private clearMarker(): void {
    if (this.markerTimer) { clearTimeout(this.markerTimer); }
    this.markerTimer = null;
    this.marker?.remove();
    this.marker = null;
  }
}
