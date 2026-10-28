/**
 * Exports the shared domain model: paper records, PDF versions, text layers, annotations, themes, log entries.
 */
export { BIBLIOGRAPHIC_FIELDS, BIBLIOGRAPHIC_STRING_FIELDS, deriveVenue } from "./paper.js";
export type { BibliographicFields, PaperRecord } from "./paper.js";
export { TEXT_LAYER_STATES, parseTextLayerDetails, ANNOTATION_COLORS, isAnnotationColor } from "./annotation.js";
export type { TextLayerState, TextLayerDetails, Annotation, AnnotationPosition, AnnotationType, AnnotationColor } from "./annotation.js";
export { PDF_THEMES, isPdfTheme, PDF_VERSIONS, PDF_VERSION_LABEL, compareVersions, isPdfVersion, isPrePublication, isPreferredVersion } from "./pdf.js";
export type { PdfTheme, PdfVersion } from "./pdf.js";
export type { LogEntry } from "./logEntry.js";
