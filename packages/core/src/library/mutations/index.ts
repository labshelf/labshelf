/** Exports library mutations' public API: every change an app makes to papers and folders on disk, over injected ports. */
export type { BatchOutcome, MutationContext, MetadataWriter, Reference, WriteRecordOptions } from "./paperRecordWrite.js";
export { readPaperOnFileSystem, writePaperRecord } from "./paperRecordWrite.js";
export { DEVICE_ID, addWriteRecord, createWriteRecordStore, readWriteRecords, recordFor } from "./paperRecordWrite.js";
export type { DeviceIdentity, WriteRecord, WriteRecordEntry, WriteRecordFileSystem, WriteRecords, WriteRecordStore } from "./paperRecordWrite.js";
export { resolveReferences, updatePaperTags, setPapersReadingStatus, updatePaperFields } from "./paperMutations.js";
export { movePapers, movePapersToTrash, createFolder, moveFolder, renameFolder, moveFolderToTrash } from "./paperMutations.js";
export type { FieldsBatchOutcome, PaperFieldsUpdate, MoveOutcome, PaperMove } from "./paperMutations.js";
export { importPaths, importPdfs, deriveMetadataFields, isLowConfidenceImport, withResolvedMetadata } from "./paperImport.js";
export { countImportOutcomes, createDoiFinder, importPdf, createPaper, isPdfBytes, findPdfsToImport } from "./paperImport.js";
export type { ImportHooks, ImportProgress, ParsedImport, PaperRecordMetadata, ImportCounts } from "./paperImport.js";
export type { ImportDeps, ImportOptions, ImportOutcome, PdfParse, CreatePaperInput, PdfDiscovery } from "./paperImport.js";
export { shouldWriteVerdict, deriveVerdictForDetection, deriveVerdictForError, deriveVerdictForOutcome, readWallClock } from "./textLayer.js";
export type { ExistingLayer, TextLayerDetection, TextLayerOutcome, TextLayerSkipKind } from "./textLayer.js";
export type { PdfTextLayerBuilder, TextLayerHooks, TextLayerProgress } from "./textLayer.js";
