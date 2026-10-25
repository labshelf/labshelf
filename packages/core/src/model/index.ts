/**
 * Exports the shared domain model: paper records, PDF versions, text layers, annotations, themes, log entries.
 */
export { BIBLIOGRAPHIC_FIELDS, BIBLIOGRAPHIC_STRING_FIELDS } from "./bibliographicFields.js";
export type { BibliographicFields } from "./bibliographicFields.js";
export type { PaperRecord } from "./paperRecord.js";
export { venueOf } from "./paperVenue.js";
export { TEXT_LAYER_STATES, parseTextLayerInfo } from "./textLayer.js";
export type { TextLayerState, TextLayerInfo } from "./textLayer.js";
export { ANNOTATION_COLORS, isAnnotationColor } from "./annotation.js";
export type { Annotation, AnnotationPosition, AnnotationType, AnnotationColor } from "./annotation.js";
export { PDF_THEMES, isPdfTheme } from "./pdfTheme.js";
export type { PdfTheme } from "./pdfTheme.js";
export { PDF_VERSIONS, PDF_VERSION_LABEL, compareVersions, isPdfVersion, isPrePublication, outranksVersion } from "./pdfVersion.js";
export type { PdfVersion } from "./pdfVersion.js";
export type { LogEntry } from "./logEntry.js";
