// Draws OCR text layers onto the pages of a pdf-lib copy of a scanned PDF.
// Page content is never re-encoded; each layer is embedded as a transparent overlay.
import type { PDFDocument } from "pdf-lib";
import type { TextLayerOutcome } from "@labshelf/core";

import type { TextLayerHooks } from "../textLayerBuilder.js";
import type { OcrDocument, TesseractOcrEngine } from "./tesseractOcrEngine.js";

export type RewriteTarget =
  | { status: "ready"; target: PDFDocument }
  | Extract<TextLayerOutcome, { status: "unavailable" }>;

export interface OverlayResult {
  cancelled: boolean;
  pagesAdded: number;
  pagesFailed: number;
}

/** Loads the PDF for rewriting. @returns the writable document, or why the file cannot be rewritten. */
export async function openRewriteTarget(pdfBytes: Uint8Array, expectedPages: number): Promise<RewriteTarget> {
  const { PDFDocument } = await import("pdf-lib");
  let target: PDFDocument;
  try {
    target = await PDFDocument.load(pdfBytes);
  } catch (error) {
    // Encrypted or structurally unusual files: leave the paper untouched.
    // Publisher DRM is the usual cause, and pdf-lib's own wording is about its API.
    const reason = /encrypted/i.test(describe(error))
      ? "the PDF is encrypted by its publisher, so text cannot be added to it"
      : `the PDF cannot be rewritten (${describe(error)})`;
    return { status: "unavailable", reason };
  }
  if (target.getPageCount() !== expectedPages) {
    return { status: "unavailable", reason: "page count differs between the reader and the writer" };
  }
  return { status: "ready", target };
}

/** Reads each listed page optically and lays the text over it. @returns how many pages gained a layer, or that the user cancelled. */
export async function overlayTextLayers(
  engine: TesseractOcrEngine,
  source: OcrDocument,
  target: PDFDocument,
  pages: number[],
  hooks: TextLayerHooks,
): Promise<OverlayResult> {
  let pagesAdded = 0;
  let pagesFailed = 0;
  for (const [position, pageNumber] of pages.entries()) {
    if (hooks.isCancelled?.()) {
      return { cancelled: true, pagesAdded, pagesFailed };
    }
    hooks.onProgress?.({ index: position + 1, total: pages.length, pageNumber });

    try {
      const result = await overlayPage(engine, source, target, pageNumber);
      if (result === "added") {
        pagesAdded += 1;
      } else if (result === "failed") {
        pagesFailed += 1;
      }
    } catch (error) {
      pagesFailed += 1;
      engine.report(`Text layer failed on page ${pageNumber}: ${describe(error)}`);
    }
  }
  return { cancelled: false, pagesAdded, pagesFailed };
}

async function overlayPage(
  engine: TesseractOcrEngine,
  source: OcrDocument,
  target: PDFDocument,
  pageNumber: number,
): Promise<"added" | "failed" | "blank"> {
  // A rotated page renders upright while its boxes stay unrotated, so the
  // layer would land sideways. Rare in papers; skipped rather than guessed.
  if ((await source.rotation(pageNumber)) % 360 !== 0) {
    return "failed";
  }
  const layer = await engine.recognizeTextLayer(await source.renderPng(pageNumber));
  if (!layer) {
    // A figure or a blank page: nothing to add, and not a failure.
    return "blank";
  }

  const [embedded] = await target.embedPdf(layer, [0]);
  const page = target.getPage(pageNumber - 1);
  // pdfjs rendered the crop box, so that is the area the layer describes.
  const box = page.getCropBox();
  page.drawPage(embedded!, { x: box.x, y: box.y, width: box.width, height: box.height });
  return "added";
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
