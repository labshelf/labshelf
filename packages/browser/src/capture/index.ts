// Exports the capture module's public API.
export { inspectTab, findPdf, safeFolder, summarizeAttempts, resetPdfSearch, saveOrAsk, refreshExisting } from "./captureService";
export type { CaptureDraft, SavedPaper, SaveDecision } from "./captureService";
export { draftFromScholarHit } from "./scholarCapture";
export { draftFromRecord } from "./recordCapture";
export { draftFromDoi } from "./doiCapture";
export { attachPdfToPaper } from "./attachPdfToPaper";
export { dropWatch, onTabLoaded, openAccessTab, watchOfTab, type AccessTabDeps } from "./watch";
