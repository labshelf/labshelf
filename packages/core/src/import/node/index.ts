/** Exports the Node-only pdf.js support: the loader, the PDF opener, the first-page PNG render and the document opener on the native canvas. */
export { createPdfjsLoader } from "./loadPdfjs.js";
export type { PdfjsLoaderOptions } from "./loadPdfjs.js";
export { NodePdfOpener } from "./nodePdfOpener.js";
export { renderFirstPagePng } from "./renderFirstPagePng.js";
export { withPdfDocument } from "./withPdfDocument.js";
export { TextLayerPdfBuilder, TesseractOcrEngine } from "./ocr/index.js";
export type { OcrDocument, TextLayerPdfOptions, TesseractOcrOptions } from "./ocr/index.js";
