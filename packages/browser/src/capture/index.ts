// Exports the capture module's public API.
export { detectTabDraft, findPdf, normalizeFolder, derivePdfMiss, refreshPdfSearch, writeOrAsk, refreshExisting } from "./captureService";
export type { CaptureDraft, SavedPaper, WriteDecision } from "./captureService";
export { createDraftFromSearchHit } from "./searchHitCapture";
export { createDraftFromPaper } from "./paperCapture";
export { attachPdfToPaper } from "./attachPdfToPaper";
export { onTabLoaded, openAccessTab, type AccessTabDeps } from "./accessTab";
export { removeWatch, watchOfTab } from "./accessWatches";
