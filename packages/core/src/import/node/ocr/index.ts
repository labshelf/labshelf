/** Exports the Node-only OCR support: the Tesseract engine and the builder that makes scanned PDFs searchable. */
export { TesseractOcrEngine } from "./tesseractOcrEngine.js";
export type { TesseractOcrOptions } from "./tesseractOcrEngine.js";
export { SearchablePdfBuilder } from "./addTextLayer.js";
export type { SearchablePdfOptions } from "./addTextLayer.js";
export type { OcrDocument } from "./ocrDocument.js";
