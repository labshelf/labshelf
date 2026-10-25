/**
 * Wires pdf.js' EventBus, link service, find controller and PDFViewer around the shell's #viewerContainer.
 */
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { EventBus, PDFFindController, PDFLinkService, PDFViewer } from "pdfjs-dist/web/pdf_viewer.mjs" with { "resolution-mode": "import" };
import { findPagePreset, derivePageColors } from "../../index.js";
import type { PdfjsReaderLib } from "./readerContext.js";
import { createReaderFind } from "./readerFindController.js";

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
