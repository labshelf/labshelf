/**
 * Public surface of the capture module.
 */
export { inspectTab, findPdf, safeFolder, summarizeAttempts, resetPdfSearch, saveOrAsk, refreshExisting } from "./captureService";
export type { CaptureDraft, SavedPaper, SaveDecision } from "./captureService";
export { draftFromScholarHit } from "./scholarCapture";
export { draftFromRecord } from "./recordCapture";
export { attachPdfToPaper } from "./addPaperFlow";
