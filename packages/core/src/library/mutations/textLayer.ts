/**
 * The text-layer step apps run on PDFs and the verdict it leaves on a paper: what a check or OCR job reports, the
 * port that runs it, and the rules that turn a report into a stored verdict and decide when it is worth writing.
 */
import type { TextLayerDetails } from "../../model/index.js";
import { formatError } from "../../errors/index.js";

/** Where the text of a PDF that has some comes from. */
export type ExistingLayer = "native" | "ocr";

/** Why a document that needs OCR was deliberately not read; apps map the code to their own wording (settings, flags). */
export type TextLayerSkipKind = "ocr-disabled" | "page-limit";

export type TextLayerOutcome =
  // The document carries a text layer on `pagesAdded` pages.
  | { status: "added"; bytes: Uint8Array; pagesAdded: number; pagesFailed: number }
  // The PDF already has text: its own, or an OCR layer added earlier.
  | { status: "not-needed"; layer: ExistingLayer }
  | { status: "cancelled" }
  // The document needs OCR but was deliberately not read (OCR off, too many pages).
  // `reason` is neutral text, safe to store on the paper and show in any app.
  | { status: "skipped"; code: TextLayerSkipKind; reason: string }
  // OCR could not run or produced nothing usable; `reason` says why.
  | { status: "unavailable"; reason: string };

/** What a document's own text layer looks like, before any OCR. */
export type TextLayerDetection =
  | { status: ExistingLayer }
  | { status: "missing"; textlessPages: number; totalPages: number }
  | { status: "unavailable"; reason: string };

export interface TextLayerProgress {
  // 1-based position among the pages being read, not the page number.
  index: number;
  total: number;
  pageNumber: number;
}

export interface TextLayerHooks {
  onProgress?: (progress: TextLayerProgress) => void;
  isCancelled?: () => boolean;
}

/** Adds a text layer to PDFs that lack one. */
export interface PdfTextLayerBuilder {
  build(pdfBytes: Uint8Array, hooks?: TextLayerHooks): Promise<TextLayerOutcome>;
  detect(pdfBytes: Uint8Array): Promise<TextLayerDetection>;
}

/** @returns the current time as an ISO timestamp */
export function readWallClock(): string {
  return new Date().toISOString();
}

/** @returns the verdict an OCR job's outcome leaves on the paper */
export function deriveVerdictForOutcome(outcome: TextLayerOutcome, now: () => string = readWallClock): TextLayerDetails {
  const checkedAt = now();
  switch (outcome.status) {
    case "added":
      return {
        state: "ocr",
        ocrPages: outcome.pagesAdded,
        ...(outcome.pagesFailed > 0 ? { failedPages: outcome.pagesFailed } : {}),
        checkedAt,
      };
    case "not-needed":
      return { state: outcome.layer, checkedAt };
    case "cancelled":
      return { state: "missing", reason: "OCR was cancelled", checkedAt };
    case "skipped":
      return { state: "missing", reason: outcome.reason, checkedAt };
    case "unavailable":
      return { state: "failed", reason: outcome.reason, checkedAt };
  }
}

/** @returns the verdict a text-layer check (no OCR) leaves on the paper */
export function deriveVerdictForDetection(detection: TextLayerDetection, now: () => string = readWallClock): TextLayerDetails {
  const checkedAt = now();
  switch (detection.status) {
    case "missing":
      return { state: "missing", checkedAt };
    case "unavailable":
      return { state: "failed", reason: detection.reason, checkedAt };
    default:
      return { state: detection.status, checkedAt };
  }
}

/** @returns the verdict for a check that threw */
export function deriveVerdictForError(error: unknown, now: () => string = readWallClock): TextLayerDetails {
  return { state: "failed", reason: formatError(error), checkedAt: now() };
}

/**
 * Whether a new verdict should replace the stored one. An unchanged verdict is not rewritten, which keeps a
 * library-wide check from touching every file.
 * @returns true when the verdict is worth writing
 */
export function shouldWriteVerdict(current: TextLayerDetails | undefined, next: TextLayerDetails): boolean {
  return !sameVerdict(current, next) && !keepsOcrDetail(current, next);
}

// Re-checking a paper LabShelf read itself finds text (an OCR layer at best, native-looking text at worst) and knows
// less than the record does (how many pages were read). The record wins.
function keepsOcrDetail(current: TextLayerDetails | undefined, next: TextLayerDetails): boolean {
  return current?.state === "ocr" && (next.state === "ocr" || next.state === "native") && next.ocrPages === undefined;
}

function sameVerdict(current: TextLayerDetails | undefined, next: TextLayerDetails): boolean {
  return current !== undefined && current.state === next.state && current.reason === next.reason
    && current.ocrPages === next.ocrPages && current.failedPages === next.failedPages;
}
