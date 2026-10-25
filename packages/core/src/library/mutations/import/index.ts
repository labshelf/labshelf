/** Exports paper import's public API: PDF discovery, the import itself, the records it builds and the summary it reports. */
export { importPaths, importPdfs } from "./importBatch.js";
export type { ImportHooks, ImportProgress } from "./importBatch.js";
export { deriveMetadataFields, isLowConfidenceImport, withResolvedMetadata } from "./importedPaperRecord.js";
export type { ParsedImport, PaperRecordMetadata } from "./importedPaperRecord.js";
export { countImportOutcomes } from "./importNotice.js";
export type { ImportCounts } from "./importNotice.js";
export { createDoiFinder, importPdf } from "./paperImport.js";
export type { ImportDeps, ImportOptions, ImportOutcome, PdfParse } from "./paperImport.js";
export { createPaper } from "./createPaper.js";
export type { CreatePaperInput } from "./createPaper.js";
export { isPdfBytes } from "./pdfBytes.js";
export { findPdfsToImport } from "./pdfDiscovery.js";
export type { PdfDiscovery } from "./pdfDiscovery.js";
