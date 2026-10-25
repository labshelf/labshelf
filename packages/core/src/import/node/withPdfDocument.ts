// Opens PDF bytes with pdf.js on the native canvas, hands the document to a callback and tears the loading task down.
import type { PdfjsLoader } from "../pdf/index.js";
import { loadNativeCanvas, type NativeCanvasModule } from "./nativeCanvas.js";
import { createNativeCanvasOptions } from "./createNativeCanvasOptions.js";
import type { PdfViewport, RenderablePage } from "./renderPagePng.js";

interface RenderPage extends RenderablePage {
  getViewport(options: { scale: number }): PdfViewport;
  cleanup(): void;
}

interface RenderDocument {
  numPages: number;
  getPage(pageNumber: number): Promise<RenderPage>;
}

/**
 * @throws when no native canvas is installed, since nothing could be drawn
 */
export async function withPdfDocument<T>(
  pdfjs: PdfjsLoader,
  pdfBytes: Uint8Array,
  use: (document: RenderDocument, canvasModule: NativeCanvasModule) => Promise<T>,
): Promise<T> {
  const canvasModule = loadNativeCanvas();
  if (!canvasModule) { throw new Error("Cannot render PDF pages: the native canvas (@napi-rs/canvas) is not installed"); }
  // PLATFORM: pdf.js takes ownership of the buffer it is given, so the caller's bytes are copied to stay usable.
  const task = await pdfjs.getDocument({ data: new Uint8Array(pdfBytes), ...createNativeCanvasOptions(canvasModule) });
  try {
    return await use((await task.promise) as unknown as RenderDocument, canvasModule);
  } finally {
    // pdf.js 6 has no PDFDocumentProxy.destroy(); the loading task owns teardown.
    await task.destroy().catch(() => undefined);
  }
}
