/** Exports the reader's runtime-neutral public API: protocol, host controller, sidecar store, preferences, themes, citation formats, toolbar auto-hide, hover crop geometry and the outline model.
 * The reader UI is exported from `dom/`. */
export * from "./protocol/index.js";
export * from "./sidecar/index.js";
export {
  mergeReaderThemes, normalizeHexColour, parseReaderThemes, ReaderThemeStore, serializeReaderThemes,
  type ReaderThemesPort, type ReaderThemeStoreOptions,
} from "./readerThemeStore.js";
export { ReaderHostController, type ReaderHostOptions } from "./hostController.js";
export { exportAnnotations } from "./hostMessages.js";
export type { ExportAnnotationsPorts, NoticeKind, PreviewPorts, ReaderHostPorts, SidecarChange } from "./hostPorts.js";
export { deriveCropRectForPreview, deriveDestPoint, type CropOptions, type PdfDestinationSpec, type Rect } from "./geometry.js";
export { classifyDestName, classifyLinkText, deriveStatementRegion, findFloatCaptionNear, type DestPoint, type DestTarget, type PageLayout } from "./destTarget.js";
export * from "./outline.js";
