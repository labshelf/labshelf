/** Exports paper import's public API: PDF discovery, the import itself, the records it builds and the summary it reports. */
export { importPaths, importPdfs } from "./importBatch.js";
export type { ImportHooks, ImportProgress } from "./importBatch.js";
export { metadataFields, needsReview, withResolvedMetadata } from "./importedPaperRecord.js";
export type { ParsedImport, RecordMetadata } from "./importedPaperRecord.js";
export { summarizeImport } from "./importNotice.js";
export type { ImportSummary } from "./importNotice.js";
export { doiLookup, importPdf } from "./paperImport.js";
export type { ImportDeps, ImportOptions, ImportOutcome, PdfParse } from "./paperImport.js";
export { writeNewPaper } from "./createPaper.js";
export type { NewPaper } from "./createPaper.js";
export { isPdfBytes } from "./pdfBytes.js";
export { discoverPdfs } from "./pdfDiscovery.js";
export type { PdfDiscovery } from "./pdfDiscovery.js";
