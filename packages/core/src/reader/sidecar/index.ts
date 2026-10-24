/** Exports the paper sidecar's public API: annotations, theme and reading position, with the store over them. */
export {
  byPageThenCreated, emptyPaperData, normalizePaperData, serializePaperData, type PaperData,
} from "./paperSidecar.js";
export { PaperDataStore, type PaperDataStoreOptions } from "./paperSidecarStore.js";
export {
  clampPage, MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, normalizeReadingState,
  type ReadingState, type SidebarState, type SidebarTab,
} from "./readingState.js";
export { createPreviewStore, PREVIEW_ANNOTATION_REFUSAL } from "./previewStore.js";
