// Exports the capture module's public API.
export { inspectTab, findPdf, safeFolder, summarizeAttempts, resetPdfSearch, saveOrAsk, refreshExisting } from "./captureService";
export type { CaptureDraft, SavedPaper, SaveDecision } from "./captureService";
export { draftFromSearchHit } from "./searchHitCapture";
export { draftFromRecord } from "./paperCapture";
export { attachPdfToPaper } from "./attachPdfToPaper";
export { onTabLoaded, openAccessTab, type AccessTabDeps } from "./accessTab";
export { dropWatch, watchOfTab } from "./accessWatches";
