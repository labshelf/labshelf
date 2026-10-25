/**
 * Restores the stored reading position once both the laid-out pages and the host's init message are in, whichever arrives second.
 */
import { type HostToWebview, deriveClampedPage } from "../../index.js";
import type { ThemeController } from "../chrome/index.js";
import type { HostBridge, PerfMarks, ReaderContext } from "../session/index.js";
import type { ReaderUi } from "./buildReaderUi.js";

type InitMessage = Extract<HostToWebview, { type: "init" }>;

export interface RestoreAnchor {
  ctx: ReaderContext;
  ui: ReaderUi;
  theme: ThemeController;
  perf: PerfMarks;
  loadingMsg: HTMLElement;
}

export class PositionRestore {
  private init: InitMessage | null = null;
  private onInit: ((msg: InitMessage) => void) | null = null;
  private pagesReady = false;
  private restored = false;
  // If the host answers late and the reader has already started moving, restoring would yank the page from under them.
  private readerMoved = false;

  /** Asks for init before anything loads, so the stored position and annotations are usually here by `pagesinit`. */
  constructor(host: HostBridge) {
    host.on("init", (msg) => { this.init = msg; this.onInit?.(msg); });
    host.post({ command: "ready-for-init" });
  }

  /**
   * Connects the restore to the open document; an init that arrives from here on is applied at once.
   */
  attach(target: RestoreAnchor): void {
    const markMoved = (): void => { this.readerMoved = true; };
    for (const type of ["wheel", "touchmove", "pointerdown"] as const) {
      target.ctx.container.addEventListener(type, markMoved, { passive: true, once: true });
    }
    document.addEventListener("keydown", markMoved, { passive: true, once: true });
    this.onInit = (msg) => this.applyInit(target, msg);
    target.ctx.eventBus.on("pagesinit", () => this.onPagesInit(target));
  }

  private onPagesInit(target: RestoreAnchor): void {
    // A reload lays the pages out again; DocumentReloader keeps the reader's spot for that one.
    if (this.pagesReady) { return; }
    const { ctx, perf, loadingMsg } = target;
    const { container, pdfViewer, pdfDocument } = ctx;
    perf.mark("pagesInit");
    this.pagesReady = true;
    pdfViewer.currentScaleValue = ctx.prefs.defaultZoom;
    // pdf.js aligns page one with the container's top edge, i.e. underneath the overlay toolbar; start above it instead.
    container.scrollTop = 0;
    loadingMsg.hidden = true;
    container.focus({ preventScroll: true });
    ctx.host.post({ command: "ready", totalPages: pdfDocument.numPages });
    if (this.init) { this.applyInit(target, this.init); }
  }

  private applyInit({ ctx, ui, theme }: RestoreAnchor, msg: InitMessage): void {
    ctx.prefs = msg.prefs;
    ui.toolbar.setAutoHide(msg.prefs.toolbarAutoHide);
    theme.apply(msg.theme, msg.effectiveTheme);
    ui.annotationsTab.setAnnotations(msg.annotations);
    ui.highlights.show(msg.annotations);
    if (!this.pagesReady || this.restored) { return; }
    this.restored = true;
    const reading = msg.prefs.restorePosition && !this.readerMoved ? msg.reading : null;
    if (reading) {
      ctx.pdfViewer.currentScaleValue = reading.scaleValue;
      const pageNumber = deriveClampedPage(reading.page, ctx.pdfDocument.numPages);
      ctx.pdfViewer.scrollPageIntoView(reading.top !== undefined
        ? { pageNumber, destArray: [null, { name: "XYZ" }, reading.left ?? null, reading.top, null], allowNegativeOffset: true }
        : { pageNumber });
      if (reading.sidebar) {
        ui.sidebar.restore(reading.sidebar);
        ui.toolbar.setSidebarOpen(reading.sidebar.open);
      }
    }
    ui.reporter.start();
  }
}
