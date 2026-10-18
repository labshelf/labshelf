// Exports the capture module's public API.
export { inspectTab, findPdf, safeFolder, summarizeAttempts, resetPdfSearch, saveOrAsk, refreshExisting } from "./captureService";
export type { CaptureDraft, SavedPaper, SaveDecision } from "./captureService";
export { draftFromSearchHit } from "./searchHitCapture";
export { draftFromRecord } from "./recordCapture";
export { attachPdfToPaper } from "./attachPdfToPaper";
export { dropWatch, onTabLoaded, openAccessTab, watchOfTab, type AccessTabDeps } from "./watch";
