/**
 * Records back/forward navigation. Installed into PDFLinkService through its duck-typed `setHistory()`, so every internal link, outline click and named destination records the place the reader left.
 */
import { HistoryStack, type ViewPosition } from "../../navigation/index.js";
import type { PdfPosition, ReaderContext } from "../session/index.js";

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
