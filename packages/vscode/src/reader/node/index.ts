/** Exports the extension host's Node-only PDF services: its one pdf.js, OCR and the text-layer builder. */
export { createOcrEngine, createTextLayerBuilder, hostPdfjs } from "./hostPdfServices.js";
export { findPdfjs } from "./pdfjsDir.js";
