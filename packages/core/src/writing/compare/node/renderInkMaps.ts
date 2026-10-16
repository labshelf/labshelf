/** Renders every page of a PDF file onto the native canvas and keeps only its ink. */
import { promises as fs } from "node:fs";

import type { PdfjsLoader } from "../../../import/index.js";
import { loadNativeCanvas, nativeRenderOptions, type PdfViewport } from "../../../import/node/index.js";
import { inkMapFromRgba, type InkMap } from "../inkMap.js";

interface RenderPage {
  getViewport(options: { scale: number }): PdfViewport;
  render(options: Record<string, unknown>): { promise: Promise<void> };
  cleanup(): void;
}

interface RenderDocument {
  numPages: number;
  getPage(pageNumber: number): Promise<RenderPage>;
}

/**
 * @param pixelsPerPoint render scale; 1.5 (108 dpi) separates text lines while keeping a page near a million pixels
 * @throws when no native canvas is installed, since nothing could be drawn
 */
export async function renderInkMaps(pdfjs: PdfjsLoader, pdfPath: string, pixelsPerPoint: number): Promise<InkMap[]> {
  const canvasModule = loadNativeCanvas();
  if (!canvasModule) { throw new Error("Cannot render PDF pages: the native canvas (@napi-rs/canvas) is not installed"); }
  const bytes = await fs.readFile(pdfPath);
  const task = await pdfjs.getDocument({ data: new Uint8Array(bytes), ...nativeRenderOptions(canvasModule) });
  try {
    const document = (await task.promise) as unknown as RenderDocument;
    const pages: InkMap[] = [];
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      const viewport = page.getViewport({ scale: pixelsPerPoint });
      const width = Math.ceil(viewport.width);
      const height = Math.ceil(viewport.height);
      const canvas = canvasModule.createCanvas(width, height);
      const context = canvas.getContext("2d");
      context.fillStyle = "white";
      context.fillRect(0, 0, width, height);
      await page.render({ canvasContext: context, viewport, canvas }).promise;
      pages.push(inkMapFromRgba(context.getImageData(0, 0, width, height).data, width, height));
      page.cleanup();
    }
    return pages;
  } finally {
    // pdf.js 6 has no PDFDocumentProxy.destroy(); the loading task owns teardown.
    await task.destroy();
  }
}
