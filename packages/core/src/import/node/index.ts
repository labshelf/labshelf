/** Exports the Node-only pdf.js support: the loader, the PDF opener, the first-page PNG render, the document opener on the native canvas and OCR. */
export { createPdfjsLoader } from "./pdfjs.js";
export type { PdfjsLoaderOptions } from "./pdfjs.js";
export { NodePdfOpener, renderFirstPagePng, withPdfDocument } from "./nativeCanvas.js";
export { TesseractOcrEngine } from "./ocr.js";
export type { OcrDocument, TesseractOcrOptions } from "./ocr.js";
export { TextLayerPdfBuilder } from "./textLayer.js";
export type { TextLayerPdfOptions } from "./textLayer.js";
