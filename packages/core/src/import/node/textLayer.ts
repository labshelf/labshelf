// Makes a scanned PDF searchable by overlaying Tesseract's invisible text on each textless page.
// Page content is never re-encoded, so the paper looks identical and grows only a few KB per page.
import type { PDFDocument } from "pdf-lib";
import type {
  ExistingLayer,
  PdfTextLayerBuilder,
  TextLayerDetection,
  TextLayerHooks,
  TextLayerOutcome,
} from "../../library/index.js";
import { isSparseText, type PdfjsLoader } from "../pdf/index.js";
import { openPdfForOcr, type OcrDocument, type TesseractOcrEngine } from "./ocr.js";
import { formatError } from "../../errors/index.js";

type RewriteTarget =
  | { status: "ready"; target: PDFDocument }
  | Extract<TextLayerOutcome, { status: "unavailable" }>;

interface OverlayResult {
  cancelled: boolean;
  pagesAdded: number;
  pagesFailed: number;
}

/** Loads the PDF for rewriting. @returns the writable document, or why the file cannot be rewritten. */
async function openRewriteTarget(pdfBytes: Uint8Array, expectedPages: number): Promise<RewriteTarget> {
  const { PDFDocument } = await import("pdf-lib");
  let target: PDFDocument;
  try {
    target = await PDFDocument.load(pdfBytes);
  } catch (error) {
    // Encrypted or structurally unusual files: leave the paper untouched.
    // Publisher DRM is the usual cause, and pdf-lib's own wording is about its API.
    const reason = /encrypted/i.test(formatError(error))
      ? "the PDF is encrypted by its publisher, so text cannot be added to it"
      : `the PDF cannot be rewritten (${formatError(error)})`;
    return { status: "unavailable", reason };
  }
  if (target.getPageCount() !== expectedPages) {
    return { status: "unavailable", reason: "page count differs between the reader and the writer" };
  }
  return { status: "ready", target };
}

/** Reads each listed page optically and lays the text over it. @returns how many pages gained a layer, or that the user cancelled. */
async function overlayTextLayers(
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
      engine.report(`Text layer failed on page ${pageNumber}: ${formatError(error)}`);
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

export interface TextLayerPdfOptions {
  // Reading a page takes seconds; a scanned book would hold the OCR worker for an hour.
  maxPages?: number | undefined;
}

const DEFAULT_MAX_PAGES = 150;
const MIN_TEXTLESS_SHARE = 0.5;

export class TextLayerPdfBuilder implements PdfTextLayerBuilder {
  constructor(
    // Absent when OCR is turned off: documents are still classified, never read.
    private readonly engine: TesseractOcrEngine | undefined,
    private readonly pdfjs: PdfjsLoader,
    private readonly options: TextLayerPdfOptions = {},
  ) {}

  /**
   * Reports whether the PDF needs OCR, without reading any page optically —
   * a fraction of a second, so it can run over a whole library.
   * @returns native, missing (with page counts), or why the PDF could not be opened.
   */
  async detect(pdfBytes: Uint8Array): Promise<TextLayerDetection> {
    const source = await openPdfForOcr(this.pdfjs, pdfBytes).catch(() => undefined);
    if (!source) {
      return { status: "unavailable", reason: "the PDF could not be opened for reading" };
    }
    try {
      const pages = await pagesWithoutText(source);
      return needsOcr(pages.length, source.numPages)
        ? { status: "missing", textlessPages: pages.length, totalPages: source.numPages }
        : { status: await existingLayer(source) };
    } finally {
      await source.close();
    }
  }

  /**
   * Reads every text-less page and returns the PDF with the text laid over it.
   * @returns The outcome; bytes are present only when a layer was actually added.
   */
  async build(pdfBytes: Uint8Array, hooks: TextLayerHooks = {}): Promise<TextLayerOutcome> {
    const source = await openPdfForOcr(this.pdfjs, pdfBytes);
    if (!source) {
      return { status: "unavailable", reason: "no native canvas build is installed for this platform" };
    }

    try {
      const pages = await pagesWithoutText(source);
      if (!needsOcr(pages.length, source.numPages)) {
        return { status: "not-needed", layer: await existingLayer(source) };
      }
      if (!this.engine) {
        return { status: "skipped", code: "ocr-disabled", reason: "OCR is turned off" };
      }
      const maxPages = this.options.maxPages ?? DEFAULT_MAX_PAGES;
      if (pages.length > maxPages) {
        return { status: "skipped", code: "page-limit", reason: `${pages.length} pages need OCR, above the limit of ${maxPages}` };
      }
      return await this.addLayers(this.engine, pdfBytes, source, pages, hooks);
    } finally {
      await source.close();
    }
  }

  private async addLayers(
    engine: TesseractOcrEngine,
    pdfBytes: Uint8Array,
    source: OcrDocument,
    pages: number[],
    hooks: TextLayerHooks,
  ): Promise<TextLayerOutcome> {
    const opened = await openRewriteTarget(pdfBytes, source.numPages);
    if (opened.status !== "ready") {
      return opened;
    }

    const overlay = await overlayTextLayers(engine, source, opened.target, pages, hooks);
    if (overlay.cancelled) {
      return { status: "cancelled" };
    }
    const { pagesAdded, pagesFailed } = overlay;
    if (pagesAdded === 0) {
      return { status: "unavailable", reason: "OCR found no text on any page" };
    }

    const bytes = await opened.target.save();
    // The file replaces the user's paper, so it is proven readable first.
    if (!(await hasTextOn(this.pdfjs, bytes, pages, source.numPages))) {
      return { status: "unavailable", reason: "the rewritten PDF did not pass verification" };
    }
    return { status: "added", bytes, pagesAdded, pagesFailed };
  }
}

// A born-digital paper has the odd page that is all figure. Reading those
// would stack a second copy of the caption over the real one; a scan is
// text-less throughout, which is what tells the two apart.
function needsOcr(textlessPages: number, totalPages: number): boolean {
  return textlessPages > 0 && textlessPages >= totalPages * MIN_TEXTLESS_SHARE;
}

// Pages searched for text before giving up: a cover or a figure can come first.
const LAYER_PROBE_PAGES = 3;

// Text that is mostly invisible sits over a scan: some OCR tool put it there.
// The first page with text decides; scans keep their masthead stamp visible,
// so a majority, not all, of the runs must be invisible.
async function existingLayer(document: OcrDocument): Promise<ExistingLayer> {
  for (let pageNumber = 1; pageNumber <= Math.min(document.numPages, LAYER_PROBE_PAGES); pageNumber += 1) {
    const share = await document.invisibleTextShare(pageNumber).catch(() => undefined);
    if (share !== undefined) {
      return share >= 0.5 ? "ocr" : "native";
    }
  }
  return "native";
}

// A page counts as text-less by the same measure the importer uses, so a
// download stamp or print header does not pass for a text layer.
async function pagesWithoutText(document: OcrDocument): Promise<number[]> {
  const pages: number[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const text = await document.pageText(pageNumber).catch(() => "");
    if (isSparseText([text])) {
      pages.push(pageNumber);
    }
  }
  return pages;
}

// Re-opens the result and confirms it still has every page and that at least
// one of the pages that were read now carries real text.
async function hasTextOn(pdfjs: PdfjsLoader, bytes: Uint8Array, pages: number[], expectedPages: number): Promise<boolean> {
  const reopened = await openPdfForOcr(pdfjs, bytes).catch(() => undefined);
  if (!reopened) {
    return false;
  }
  try {
    if (reopened.numPages !== expectedPages) {
      return false;
    }
    const stillEmpty = await pagesWithoutText(reopened);
    return pages.some((pageNumber) => !stillEmpty.includes(pageNumber));
  } finally {
    await reopened.close();
  }
}
