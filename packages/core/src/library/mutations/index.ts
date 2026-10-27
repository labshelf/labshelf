/** Exports library mutations' public API: every change an app makes to papers and folders on disk, over injected ports. */
export type { BatchOutcome, MutationContext, MetadataWriter, Reference } from "./mutationDeps.js";
export { resolveReferences } from "./resolveReferences.js";
export { readPaperOnFileSystem } from "./paperOnFileSystem.js";
export { writePaperRecord } from "./paperRecordWrite.js";
export type { WriteRecordOptions } from "./paperRecordWrite.js";
export { updatePaperTags, setPapersReadingStatus, updatePaperFields } from "./paperFields.js";
export type { FieldsBatchOutcome, PaperFieldsUpdate } from "./paperFields.js";
export { movePapers, movePapersToTrash } from "./paperMoves.js";
export type { MoveOutcome, PaperMove } from "./paperMoves.js";
export { createFolder, moveFolder, renameFolder, moveFolderToTrash } from "./folderOps.js";
export * from "./import/index.js";
export * from "./textLayer/index.js";
