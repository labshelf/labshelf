/** Exports the native canvas pdf.js renders on in Node: its loader, the getDocument options that select it and the page-to-PNG render. */
export { loadNativeCanvas } from "./nativeCanvas.js";
export type { NativeCanvas, NativeCanvasContext, NativeCanvasModule } from "./nativeCanvas.js";
export { nativeRenderOptions } from "./nativeRenderOptions.js";
export { renderPagePng } from "./renderPagePng.js";
export type { PdfViewport, RenderablePage } from "./renderPagePng.js";
