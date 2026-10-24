/** Exports the library domain's public API: folders, paper metadata and the on-disk layout. */
export { relocatePapersUnder, removePapersUnder } from "./paperRecordReindex.js";
export type { IPaperRecordIndex } from "./paperRecordReindex.js";
export { paperRecordFromMetadata, parsePaperMetadata } from "./paperMetadata.js";
export type { PaperLocation } from "./paperMetadata.js";
export {
  PAPERS_DIR, RESEARCH_DIR, PROJECTS_DIR, SPACES_DIR,
  PDF_FILE, METADATA_FILE, BIB_FILE, SIDECAR_FILE, PAPER_NOTES_FILE, SPACE_FILE, GLOSSARY_FILE,
  joinWith, libraryLayout, paperFiles,
} from "./layout.js";
export type { Join, LibraryLayout, PaperFiles } from "./layout.js";
export { relativePathProblem } from "./relativePath.js";
export * from "./paper/index.js";
export { SHARED_CONFIG_VERSION, mergeSharedConfig, parseSharedConfig, serializeSharedConfig } from "./sharedConfig.js";
export type { SharedConfig, SharedConfigPatch } from "./sharedConfig.js";
export * from "./externalChange/index.js";
export * from "./mutations/index.js";
export * from "./model/index.js";
export * from "./folder/index.js";
export * from "./search/index.js";
export * from "./paperFiles/index.js";
export * from "./conflicts/index.js";
export * from "./syncGuide/index.js";
export * from "./writeRecords/index.js";
