/** Exports the reader's runtime-neutral public API: protocol, host controller, sidecar store, preferences, themes, citation formats, toolbar auto-hide, hover crop geometry and the outline model.
 * The reader UI is exported from `dom/`. */
export * from "./protocol/index.js";
export * from "./sidecar/index.js";
export * from "./host/index.js";
export { deriveCropRectForPreview, deriveDestPoint, type CropOptions, type PdfDestinationSpec, type Rect } from "./text/geometry.js";
export * from "./navigation/outline.js";
