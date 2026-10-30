/** Exports the paper sidecar's public API: annotations and reading position, with the stores over them. */
export {
  compareAnnotations, createEmptyPaperSidecar, createPreviewStore, normalizePaperSidecar, PaperSidecarStore, PREVIEW_ANNOTATION_REFUSAL,
  serializePaperSidecar, type PaperSidecar, type PaperSidecarStoreOptions, type ReaderSidecarStore,
} from "./sidecarStore.js";
export {
  deriveClampedPage, MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, normalizeReadingPosition,
  type ReadingState, type SidebarState, type SidebarTab,
} from "./readingState.js";
