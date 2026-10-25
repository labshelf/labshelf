/** Compares two PDF files and returns the regions that changed on each side's pages. */
import { promises as fs } from "node:fs";
import type { PdfjsLoader } from "../../../import/index.js";
import type { ILogger } from "../../../ports/index.js";
import { comparePdfPages, type PdfChanges } from "../comparePdfPages.js";
import { withPdfDocument } from "../../../import/node/index.js";
import { derivePageInk, type PageInk } from "../pageInk.js";

/**
 * @param pixelsPerPoint render scale; 1.5 (108 dpi) separates text lines while keeping a page near a million pixels
 * @throws when no native canvas is installed, since nothing could be drawn
 */
async function renderPageInks(pdfjs: PdfjsLoader, pdfPath: string, pixelsPerPoint: number): Promise<PageInk[]> {
  const bytes = await fs.readFile(pdfPath);
  return withPdfDocument(pdfjs, bytes, async (document, canvasModule) => {
    const pages: PageInk[] = [];
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
      pages.push(derivePageInk(context.getImageData(0, 0, width, height).data, width, height));
      page.cleanup();
    }
    return pages;
  });
}

const MODULE = "writing/compare";
const PIXELS_PER_POINT = 1.5;

export async function comparePdfs(pdfjs: PdfjsLoader, beforePdf: string, afterPdf: string, logger: ILogger): Promise<PdfChanges> {
  const started = Date.now();
  const before = await renderPageInks(pdfjs, beforePdf, PIXELS_PER_POINT);
  const after = await renderPageInks(pdfjs, afterPdf, PIXELS_PER_POINT);
  const changes = comparePdfPages(before, after, PIXELS_PER_POINT);
  void logger.log("INFO", MODULE, "Compared PDFs", {
    beforePdf, afterPdf, beforePages: before.length, afterPages: after.length,
    beforeAreas: changes.before.length, afterAreas: changes.after.length, ms: Date.now() - started,
  });
  return changes;
}
