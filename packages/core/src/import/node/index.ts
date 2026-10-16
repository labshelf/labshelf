/** Exports the Node-only pdf.js support: the loader, the document opener and the native canvas pdf.js renders on. */
export { createPdfjsLoader } from "./loadPdfjs.js";
export type { PdfjsLoaderOptions } from "./loadPdfjs.js";
export { NodePdfOpener } from "./nodePdfOpener.js";
export { loadNativeCanvas, nativeRenderOptions, renderPagePng } from "./canvas/index.js";
export type { NativeCanvas, NativeCanvasContext, NativeCanvasModule, PdfViewport, RenderablePage } from "./canvas/index.js";
export { SearchablePdfBuilder, TesseractOcrEngine } from "./ocr/index.js";
export type { OcrDocument, SearchablePdfOptions, TesseractOcrOptions } from "./ocr/index.js";
