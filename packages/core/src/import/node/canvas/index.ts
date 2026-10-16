/** Exports the native canvas pdf.js renders on in Node: its loader, the getDocument options that select it, the page-to-PNG render and the document opener. */
export { loadNativeCanvas } from "./nativeCanvas.js";
export type { NativeCanvasModule } from "./nativeCanvas.js";
export { nativeRenderOptions } from "./nativeRenderOptions.js";
export { renderFirstPagePng } from "./renderFirstPagePng.js";
export { renderPagePng } from "./renderPagePng.js";
export type { PdfViewport } from "./renderPagePng.js";
export { withPdfDocument } from "./withPdfDocument.js";
