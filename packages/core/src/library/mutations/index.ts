/** Exports library mutations' public API: every change an app makes to papers, their files and folders on disk, over injected ports. */
export type { BatchOutcome, MutationContext, MetadataWriter, Reference, WriteRecordOptions } from "./paperRecordWrite.js";
export { readPaperOnFileSystem, writePaperRecord } from "./paperRecordWrite.js";
export { resolveReferences, updatePaperTags, setPapersReadingStatus, updatePaperFields, describePaperFileOnFileSystem } from "./paperMutations.js";
export { movePapers, movePapersToTrash, createFolder, moveFolder, renameFolder, moveFolderToTrash } from "./paperMutations.js";
export type { FieldsBatchOutcome, PaperFieldsUpdate, MoveOutcome, PaperMove } from "./paperMutations.js";
export { importPaths, importPdfs, deriveMetadataFields, isLowConfidenceImport, withResolvedMetadata } from "./paperImport.js";
export { countImportOutcomes, createDoiFinder, importPdf, createPaper, isPdfBytes } from "./paperImport.js";
export { findPdfsToImport, type PdfDiscovery } from "./folderReads.js";
export type { ImportHooks, ImportProgress, ParsedImport, PaperRecordMetadata, ImportCounts } from "./paperImport.js";
export type { ImportDeps, ImportOptions, ImportOutcome, PdfParse, CreatePaperInput } from "./paperImport.js";
