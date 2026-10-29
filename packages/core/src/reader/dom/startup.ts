// Runs the startup steps of an open document: restore and report the reading position, report first render, run actions and open external links.
import { type HostToWebview, deriveClampedPage, type ReadingState } from "../index.js";
import type { ThemeController } from "./theme.js";
import type { HostBridge, PerfMarks, ReaderContext, PdfPosition } from "./readerSession.js";
import type { ReaderUi, DeferredHover } from "./readerUi.js";
import { createDebouncer } from "../../async/index.js";
import { isPresetScale } from "../viewNavigation.js";
import type { ReaderAction } from "../keymap.js";
import type { Sidebar } from "./sidebar.js";
import { closePopover, isPopoverOpen } from "./elements.js";

/**
 * Restores the stored reading position once both the laid-out pages and the host's init message are in, whichever arrives second.
 */

type InitMessage = Extract<HostToWebview, { type: "init" }>;

interface RestoreAnchor {
  ctx: ReaderContext;
  ui: ReaderUi;
  theme: ThemeController;
  perf: PerfMarks;
  loadingMsg: HTMLElement;
}

export class ReadingPositionRestore {
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
    // A reload lays the pages out again; PdfReloader keeps the reader's spot for that one.
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
    ui.notesTab.setAnnotations(msg.annotations);
    ui.notesTab.show(msg.notes);
    ui.noteBoxes.show(msg.notes);
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

/**
 * Reports the reading position (page, zoom, offset, sidebar) to the host for persistence, debounced while reading and flushed when the panel hides.
 */

const SAVE_DEBOUNCE_MS = 800;

export class ReadingPositionReporter {
  private location: PdfPosition | null = null;
  private enabled = false;
  private readonly save = createDebouncer(() => this.post(), SAVE_DEBOUNCE_MS);

  constructor(private readonly ctx: ReaderContext, private readonly sidebar: Sidebar) {
    ctx.eventBus.on("updateviewarea", (evt: { location?: PdfPosition }) => {
      if (!evt.location) { return; }
      this.location = evt.location;
      if (this.enabled) { this.save.call(); }
    });
    sidebar.onChange(() => { if (this.enabled) { this.save.call(); } });
    document.addEventListener("visibilitychange", () => { if (document.hidden) { this.save.flush(); } });
    window.addEventListener("pagehide", () => this.save.flush());
  }

  /**
   * Reporting starts only after restore, so the initial page-1 layout never overwrites the stored position.
   */
  start(): void {
    this.enabled = true;
  }

  private post(): void {
    const loc = this.location;
    if (!loc) { return; }
    const value = this.ctx.pdfViewer.currentScaleValue;
    const state: ReadingState = {
      page: loc.pageNumber,
      // A preset survives window resizes; a number pins the exact zoom the reader chose.
      scaleValue: isPresetScale(value) ? value : String(this.ctx.pdfViewer.currentScale),
      left: loc.left,
      top: loc.top,
      sidebar: this.sidebar.state,
      updatedAt: new Date().toISOString(),
    };
    this.ctx.host.post({ command: "saveReadingState", state });
  }
}

/**
 * Posts the open timeline to the host once the first page is on screen, so slow opens can be diagnosed from app.log without DevTools.
 */

interface PageRenderedEvent {
  source?: { canvas?: HTMLCanvasElement };
  pageNumber: number;
}

/**
 * Reports the first `pagerendered` once, then lets the hover preview build itself.
 */
export function reportFirstRender(ctx: ReaderContext, theme: ThemeController, perf: PerfMarks, hover: DeferredHover): void {
  let reported = false;
  ctx.eventBus.on("pagerendered", ({ source, pageNumber }: PageRenderedEvent) => {
    if (reported) { return; }
    reported = true;
    perf.mark("firstPageRendered");
    const cv = source?.canvas;
    ctx.host.post({
      command: "perf",
      timeline: perf.timeline,
      pageNumber,
      theme: theme.effective,
      dpr: window.devicePixelRatio,
      canvas: cv ? `${cv.width}x${cv.height}` : null,
    });
    hover.createWhenIdle();
  });
}

/**
 * Maps each keyboard or host ReaderAction to the UI piece that performs it.
 */

interface ActionDeps {
  ctx: ReaderContext;
  ui: ReaderUi;
  hover: DeferredHover;
}

/**
 * @returns the function Keyboard calls for every action it resolves.
 */
export function createActionRunner({ ctx, ui, hover }: ActionDeps): (action: ReaderAction) => void {
  const { container, pdfViewer } = ctx;
  const { goToPage, findBar, zoom, history, pill, sidebar, cheatsheet, bubble } = ui;
  const pageStep = (fraction: number): void => {
    container.scrollBy({ top: container.clientHeight * fraction, behavior: "smooth" });
  };
  return (action) => {
    switch (action) {
      case "pageDown": pageStep(0.9); break;
      case "pageUp": pageStep(-0.9); break;
      case "halfPageDown": pageStep(0.5); break;
      case "halfPageUp": pageStep(-0.5); break;
      case "nextPage": pdfViewer.nextPage(); break;
      case "prevPage": pdfViewer.previousPage(); break;
      case "firstPage": goToPage(1); break;
      case "lastPage": goToPage(ctx.pdfDocument.numPages); break;
      case "find": findBar.show(); break;
      case "findNext": findBar.again(false); break;
      case "findPrev": findBar.again(true); break;
      case "zoomIn": zoom.zoomIn(); break;
      case "zoomOut": zoom.zoomOut(); break;
      case "zoomReset": zoom.setPreset(ctx.prefs.defaultZoom); break;
      case "fitWidth": zoom.setPreset("page-width"); break;
      case "fitPage": zoom.setPreset("page-fit"); break;
      case "historyBack": history.back(); break;
      case "historyForward": history.forward(); break;
      case "goToPage": pill.focusPageInput(); break;
      case "toggleSidebar": sidebar.toggle(); break;
      case "toggleBoxTool": if (!ctx.boot.preview) { ui.boxTool.toggle(); } break;
      case "cheatsheet": cheatsheet.toggle(); break;
      case "recompile": ctx.host.post({ command: "recompile" }); break;
      case "nextProblem": ui.previewChrome?.problems.step(1); break;
      case "prevProblem": ui.previewChrome?.problems.step(-1); break;
      case "copyWithCitation": bubble.copyWithCitation(); break;
      case "escape": closeInnermost(ui, hover); break;
      // Held-key scrolling is driven by Keyboard itself.
      case "scrollDown": case "scrollUp": case "scrollLeft": case "scrollRight": break;
    }
  };
}

/** Escape closes the innermost transient surface first. */
function closeInnermost(ui: ReaderUi, hover: DeferredHover): void {
  if (ui.cheatsheet.isOpen) { ui.cheatsheet.close(); }
  else if (isPopoverOpen()) { closePopover(); }
  else if (ui.findBar.isOpen) { ui.findBar.close(); }
  else { ui.bubble.hide(); hover.close(); }
}

/**
 * Routes clicks on external links through the host's scheme allow-list instead of the webview's default navigation.
 */

/**
 * Intercepts http(s) and mailto link clicks inside `viewer` in the capture phase.
 */
export function attachExternalUrls(viewer: HTMLElement, host: HostBridge): void {
  viewer.addEventListener("click", (e) => {
    const a = (e.target as Element).closest?.("a[href]");
    const href = a?.getAttribute("href") ?? "";
    if (!/^(https?:|mailto:)/i.test(href)) { return; }
    e.preventDefault();
    e.stopPropagation();
    host.post({ command: "openExternalLink", url: href });
  }, true);
}
