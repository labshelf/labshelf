// Builds the reader session: the pdf.js reader, the context every part shares, the host bridge, the text-layer focus guard, perf marks and find.
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { EventBus, PDFFindController, PDFLinkService, PDFViewer } from "pdfjs-dist/web/pdf_viewer.mjs";
import {
  findPagePreset, derivePageColors, type ReaderStartupParams, type ReaderPrefs, type HostToWebview, type WebviewToHost,
  type ReaderTimeline,
} from "../../index.js";
import { deriveMatchScroll, deriveFreshOrigin, type FindOrigin } from "../../navigation/index.js";

/**
 * Wires pdf.js' EventBus, link service, find controller and PDFViewer around the shell's #viewerContainer.
 */

export interface PdfjsReaderParts {
  eventBus: EventBus;
  linkService: PDFLinkService;
  findController: PDFFindController;
  pdfViewer: PDFViewer;
  /** Must be called right before a `find` event is dispatched; see createReaderFind. */
  markFindOrigin(): void;
}

/**
 * @returns the constructed viewer parts with the document already attached.
 */
export function createPdfjsReader(
  viewerLib: PdfjsReaderLib,
  pdfDocument: PDFDocumentProxy,
  container: HTMLDivElement,
  viewer: HTMLDivElement,
  pageTheme: string,
  preview: boolean,
): PdfjsReaderParts {
  const eventBus = new viewerLib.EventBus();
  // A link's stored zoom ("XYZ ... 0.8") would silently undo the reader's chosen zoom on every click.
  const linkService = new viewerLib.PDFLinkService({ eventBus, ignoreDestinationZoom: true });
  const { findController, markFindOrigin } = createReaderFind(viewerLib, container, linkService, eventBus);
  const preset = findPagePreset(pageTheme);
  const pdfViewer = new viewerLib.PDFViewer({
    container,
    viewer,
    eventBus,
    linkService,
    findController,
    textLayerMode: 1,
    annotationMode: 2,
    // PLATFORM: pdf.js reserves 40px for fit presets unless page borders are disabled.
    removePageBorders: preview,
    // pdf.js defaults: bounded canvases, with a detail canvas keeping the visible region sharp at high zoom.
    // Uncapped canvases reach hundreds of megapixels at 8x on a HiDPI display.
    maxCanvasPixels: 2 ** 25,
    capCanvasAreaFactor: 200,
    maxCanvasDim: 32767,
    enableDetailCanvas: true,
    enableHWA: true,
    pageColors: derivePageColors(preset.bg, preset.text),
  } as ConstructorParameters<PdfjsReaderLib["PDFViewer"]>[0]);
  linkService.setViewer(pdfViewer);
  linkService.setDocument(pdfDocument, null);
  // Also hands the document to the find controller.
  pdfViewer.setDocument(pdfDocument);
  return { eventBus, linkService, findController, pdfViewer, markFindOrigin };
}

/**
 * Declares the shared handles every reader UI module works against once the document is open.
 */

export type PdfjsLib = typeof import("pdfjs-dist");
export type PdfjsReaderLib = typeof import("pdfjs-dist/web/pdf_viewer.mjs", { with: { "resolution-mode": "import" } });

export interface ReaderContext {
  boot: ReaderStartupParams;
  host: HostBridge;
  pdfjsLib: PdfjsLib;
  viewerLib: PdfjsReaderLib;
  pdfDocument: PDFDocumentProxy;
  pdfViewer: PDFViewer;
  eventBus: EventBus;
  linkService: PDFLinkService;
  findController: PDFFindController;
  /** Snapshot of the scroll position taken right before a find command, so an already-visible hit does not move the page. */
  markFindOrigin(): void;
  container: HTMLDivElement;
  /** Live preferences; replaced in place on `prefsChanged`. */
  prefs: ReaderPrefs;
}

/** Location payload of pdf.js' `updateviewarea` event. */
export interface PdfPosition {
  pageNumber: number;
  scale: number | string;
  left: number;
  top: number;
  rotation?: number;
  pdfOpenParams?: string;
}

// Wraps the reader's host transport in typed messages; the entry point decides which host is on the other side.

/** How messages travel between the reader UI and its host. */
export interface ReaderTransport {
  /** Hands one message to the host; must never throw into UI code. */
  post(msg: WebviewToHost): void;
  /** Installs the single sink for host messages; HostBridge calls it once and validates each message's shape. */
  listen(sink: (msg: unknown) => void): void;
}

type Handler<T extends HostToWebview["type"]> = (msg: Extract<HostToWebview, { type: T }>) => void;

export class HostBridge {
  private readonly handlers = new Map<string, Array<(msg: HostToWebview) => void>>();

  constructor(private readonly transport: ReaderTransport) {
    transport.listen((raw) => {
      const msg = raw as HostToWebview | null;
      if (!msg || typeof msg !== "object" || typeof msg.type !== "string") { return; }
      for (const fn of this.handlers.get(msg.type) ?? []) { fn(msg); }
    });
  }

  /**
   * Sends a message to the host.
   */
  post(msg: WebviewToHost): void {
    this.transport.post(msg);
  }

  /**
   * Registers a handler invoked whenever the host sends a message of the given type.
   */
  on<T extends HostToWebview["type"]>(type: T, handler: Handler<T>): void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler as (msg: HostToWebview) => void);
    this.handlers.set(type, list);
  }
}

// Stops pdf.js from scrolling the document when it focuses a page's text layer.

let installed = false;

/**
 * Idempotent; must run before pdf.js renders its first text layer.
 */
export function installTextLayerFocusGuard(): void {
  if (installed) { return; }
  installed = true;
  // PLATFORM: after a link is followed, pdf.js PDFLinkService calls `textLayer.div.focus()` once the destination
  // renders, and focus scrolls. If the reader already pressed Back (peek at a reference and return), that late focus
  // drags them to the destination again, and it can nudge the XYZ position the link asked for. Focus is kept; only
  // its scrolling is removed.
  const nativeFocus = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function focus(this: HTMLElement, options?: FocusOptions): void {
    if (this.classList.contains("textLayer")) {
      nativeFocus.call(this, { ...options, preventScroll: true });
      return;
    }
    nativeFocus.call(this, options);
  };
}

/**
 * Records the reader's open timeline: milliseconds since page start for each milestone, plus a few measured values.
 */

export class PerfMarks {
  readonly timeline: ReaderTimeline = { scriptStart: Math.round(performance.now()) };

  /**
   * Records the current time under `name`.
   */
  mark(name: string): void { this.timeline[name] = Math.round(performance.now()); }

  /**
   * Records an explicit value under `name` (e.g. a byte count, not a timestamp).
   */
  set(name: string, value: number): void { this.timeline[name] = value; }
}

/**
 * Extends pdf.js' find controller with a scroll step that keeps an already-readable hit in place and parks others below the overlay chrome.
 */

export interface ReaderFind {
  findController: PDFFindController;
  /** Must be called right before a `find` event is dispatched. */
  markFindOrigin(): void;
}

type ScrollMatchArgs = Parameters<PDFFindController["scrollMatchIntoView"]>[0];

/**
 * pdf.js handles a find step in two scrolls: first the hit's page is scrolled to its top, then (once that page's
 * text layer exists) the hit is parked 50px below the container top — underneath this reader's overlay toolbar
 * and find bar. It does both even when the hit was already on screen. So: remember where the reader was when the
 * command was issued, let pdf.js finish, then either go back there (hit was readable) or place the hit properly.
 * @returns the find controller and the hook that records the reader's position before a find command.
 */
export function createReaderFind(
  viewerLib: PdfjsReaderLib,
  container: HTMLDivElement,
  linkService: PDFLinkService,
  eventBus: EventBus,
): ReaderFind {
  let findOrigin: FindOrigin | null = null;
  class ReaderFindController extends viewerLib.PDFFindController {
    override scrollMatchIntoView(args: ScrollMatchArgs): void {
      const element = args?.element;
      const startTop = container.scrollTop;
      super.scrollMatchIntoView(args);
      // Unchanged scroll position means pdf.js declined to scroll (not the selected hit).
      if (!element || container.scrollTop === startTop) { return; }
      const origin = deriveFreshOrigin(findOrigin, performance.now());
      findOrigin = null;
      const containerTop = container.getBoundingClientRect().top;
      const rect = element.getBoundingClientRect();
      const yNow = rect.top - containerTop;
      // Where the hit sat on screen when the command was issued.
      const shift = origin ? container.scrollTop - origin.top : 0;
      const before = origin ? { top: yNow + shift, bottom: yNow + rect.height + shift } : null;
      const decision = deriveMatchScroll(before, container.clientHeight);
      if (decision.kind === "stay" && origin) {
        container.scrollTop = origin.top;
        container.scrollLeft = origin.left;
      } else if (decision.kind === "place") {
        container.scrollTop += yNow - decision.top;
      }
    }
  }
  const findController = new ReaderFindController({ linkService, eventBus, updateMatchesCountOnProgress: true });
  const markFindOrigin = (): void => {
    findOrigin = { top: container.scrollTop, left: container.scrollLeft, at: performance.now() };
  };
  return { findController, markFindOrigin };
}
