/** Compares two PDF files and returns the regions that changed on each side's pages. */
import type { PdfjsLoader } from "../../../import/index.js";
import type { ILogger } from "../../../ports/index.js";
import { diffPages, type PdfChanges } from "../diffPages.js";
import { renderInkMaps } from "./renderPageInk.js";

const MODULE = "writing/compare";
const PIXELS_PER_POINT = 1.5;

export async function comparePdfs(pdfjs: PdfjsLoader, beforePdf: string, afterPdf: string, logger: ILogger): Promise<PdfChanges> {
  const started = Date.now();
  const before = await renderInkMaps(pdfjs, beforePdf, PIXELS_PER_POINT);
  const after = await renderInkMaps(pdfjs, afterPdf, PIXELS_PER_POINT);
  const changes = diffPages(before, after, PIXELS_PER_POINT);
  void logger.log("INFO", MODULE, "Compared PDFs", {
    beforePdf, afterPdf, beforePages: before.length, afterPages: after.length,
    beforeAreas: changes.before.length, afterAreas: changes.after.length, ms: Date.now() - started,
  });
  return changes;
}
