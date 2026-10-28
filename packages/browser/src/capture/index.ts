// Exports the capture module's public API.
export {
  detectTabDraft, findPdf, normalizeFolder, derivePdfMiss, refreshPdfSearch, writeOrAsk, refreshExisting, createDraftFromSearchHit, createDraftFromPaper,
  loadPdfjs, readFirstPageText,
} from "./pdfFinding";
export type { CaptureDraft, SavedPaper, WriteDecision } from "./pdfFinding";
export { attachPdfToPaper } from "./attach";
export { onTabLoaded, openAccessTab, removeWatch, watchOfTab, type AccessTabDeps } from "./accessWatches";
export { fetchInTab } from "./tabFetch";
