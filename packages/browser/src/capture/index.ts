/**
 * Public surface of the capture module.
 */
export { inspectTab, findPdf, saveDraft, safeFolder, summarizeAttempts, resetPdfSearch, saveOrAsk, refreshExisting } from "./captureService";
export type { CaptureDraft, SaveOptions, SavedPaper, SaveDecision } from "./captureService";
export { draftFromScholarHit } from "./scholarCapture";
export { draftFromRecord } from "./recordCapture";
export { attachPdfToPaper } from "./addPaperFlow";
export { isPdfBytes } from "./pdfBytes";
