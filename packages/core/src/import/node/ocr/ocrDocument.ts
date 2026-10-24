// Opens a PDF for optical reading: renders pages to PNG on the native canvas and reads their existing text.
import { invisibleShare, type OperatorList } from "./invisibleTextShare.js";
import { loadNativeCanvas } from "../nativeCanvas.js";
import { nativeRenderOptions } from "../nativeRenderOptions.js";
import { renderPagePng } from "../renderPagePng.js";
import type { PdfjsLoader } from "../../pdf/index.js";
import type { PdfViewport } from "../renderPagePng.js";

// Tesseract wants roughly 300 DPI; PDF user space is 72 DPI.
const RENDER_SCALE = 300 / 72;
// Guards against a pathological page size exhausting memory.
const MAX_RENDER_PIXELS = 40_000_000;

/** A PDF opened for optical reading; close() must be called when done. */
export interface OcrDocument {
  numPages: number;
  // The page's existing text layer, empty for a scan.
  pageText(pageNumber: number): Promise<string>;
  // The page's /Rotate angle; a rotated page renders upright, unlike its media box.
  rotation(pageNumber: number): Promise<number>;
  // Share of the page's text runs drawn invisibly (render mode 3 or 7), which
  // is how every OCR tool lays its text over a scan; undefined when no text.
  invisibleTextShare(pageNumber: number): Promise<number | undefined>;
  renderPng(pageNumber: number): Promise<Buffer>;
  close(): Promise<void>;
}

/**
 * Opens a PDF for rendering onto the native canvas.
 * @returns The document handle, or undefined when no native canvas is installed.
 */
export async function openPdfForOcr(pdfjs: PdfjsLoader, pdfBytes: Uint8Array): Promise<OcrDocument | undefined> {
  const canvasPkg = loadNativeCanvas();
  if (!canvasPkg) {
    return undefined;
  }

  // The extension host is not recognised as Node by pdfjs, which would then
  // reach for a DOM canvas; the render options pin the native one instead.
  const loadingTask = await pdfjs.getDocument({ data: new Uint8Array(pdfBytes), ...nativeRenderOptions(canvasPkg) });
  const document = (await loadingTask.promise) as unknown as PdfRenderDocument;
  const { OPS } = (await pdfjs.load()) as { OPS: Record<string, number> };

  return {
    numPages: document.numPages,
    async pageText(pageNumber) {
      const content = await (await document.getPage(pageNumber)).getTextContent();
      return content.items.map((item) => item.str ?? "").join(" ");
    },
    async rotation(pageNumber) {
      return (await document.getPage(pageNumber)).rotate ?? 0;
    },
    async invisibleTextShare(pageNumber) {
      const ops = await (await document.getPage(pageNumber)).getOperatorList();
      return invisibleShare(ops, OPS);
    },
    async renderPng(pageNumber) {
      const page = await document.getPage(pageNumber);
      const viewport = scaledViewport(page);
      return renderPagePng(canvasPkg, page, viewport);
    },
    async close() {
      // The loading task owns teardown; pdfjs 6 has no PDFDocumentProxy.destroy().
      await loadingTask.destroy().catch(() => undefined);
    },
  };
}

function scaledViewport(page: PdfRenderPage): PdfViewport {
  const scaled = page.getViewport({ scale: RENDER_SCALE });
  const pixels = scaled.width * scaled.height;
  if (pixels <= MAX_RENDER_PIXELS) {
    return scaled;
  }
  return page.getViewport({ scale: RENDER_SCALE * Math.sqrt(MAX_RENDER_PIXELS / pixels) });
}

interface PdfRenderPage {
  rotate?: number;
  getOperatorList(): Promise<OperatorList>;
  getTextContent(): Promise<{ items: Array<{ str?: string }> }>;
  getViewport(options: { scale: number }): PdfViewport;
  render(options: Record<string, unknown>): { promise: Promise<void> };
}

interface PdfRenderDocument {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfRenderPage>;
}
