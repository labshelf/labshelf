/**
 * Public API of the extension host's PDF services: pdf.js, OCR and the searchable-PDF builder.
 */
export { SearchablePdfBuilder } from "./searchablePdfBuilder";
export type { PdfTextLayerBuilder, TextLayerHooks, TextLayerProgress } from "./searchablePdfBuilder";
export { createOcrEngine, createTextLayerBuilder, hostPdfjs } from "./hostPdfServices";
