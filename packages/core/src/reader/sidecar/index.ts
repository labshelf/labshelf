/** Exports the paper sidecar's public API: annotations, theme and reading position, with the store over them. */
export {
  compareAnnotations, createEmptyPaperSidecar, normalizePaperSidecar, serializePaperSidecar, type PaperSidecar,
} from "./paperSidecar.js";
export { PaperSidecarStore, type PaperSidecarStoreOptions } from "./paperSidecarStore.js";
export {
  deriveClampedPage, MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, normalizeReadingPosition,
  type ReadingState, type SidebarState, type SidebarTab,
} from "./readingState.js";
export { createPreviewStore, PREVIEW_ANNOTATION_REFUSAL } from "./previewStore.js";
