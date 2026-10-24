/**
 * Tells whether a paper's PDF lacks a text layer (search and selection fail in it) and words its OCR job and
 * text-layer state.
 */
import type { TextLayerInfo } from "../../model/index.js";
import type { TextLayerJobView } from "../protocol/index.js";

/** A paper whose PDF is a scan nobody has read yet, or whose OCR failed; a paper without a PDF never counts. */
export function hasNoText(p: { hasPdf: boolean; textLayer?: TextLayerInfo | undefined }): boolean {
  const state = p.textLayer?.state;
  return p.hasPdf && (state === "missing" || state === "failed");
}

export function jobText(job: TextLayerJobView): string {
  return job.phase === "reading"
    ? `Making searchable — reading page ${job.page ?? 1} of ${job.total ?? 1}…`
    : "Waiting to be made searchable…";
}

/** Pages already read, out of all the pages to read, in percent. */
export function jobProgress(job: TextLayerJobView): number {
  return job.phase === "reading" && job.total ? Math.round((100 * ((job.page ?? 1) - 1)) / job.total) : 0;
}

/** @returns the File section's "Text" line */
export function textLayerSummary(p: { hasPdf: boolean; textLayer?: TextLayerInfo | undefined }, job: TextLayerJobView | undefined): string {
  if (job) return jobText(job);
  if (!p.hasPdf) return "No PDF";
  const tl = p.textLayer;
  if (!tl) return "Not checked yet";
  if (tl.state === "native") return "Embedded in the PDF";
  if (tl.state === "ocr") {
    const pages = tl.ocrPages ? ` · ${tl.ocrPages} page${tl.ocrPages === 1 ? "" : "s"}` : "";
    return `Added by OCR${pages}${tl.failedPages ? `, ${tl.failedPages} unreadable` : ""}`;
  }
  return tl.state === "failed" ? "None (OCR failed)" : "None";
}
