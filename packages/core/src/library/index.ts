/** Exports the library domain's public API: folders, paper metadata, reading status and the on-disk layout. */
export { movePapersUnder, removePapersUnder } from "./paperRecordReindex.js";
export type { IPaperRecordCache } from "./paperRecordReindex.js";
export { createPaperRecord, parsePaperMetadata } from "./paperMetadata.js";
export type { PaperDeviceFolder } from "./paperMetadata.js";
export {
  PAPERS_DIR, RESEARCH_DIR, PROJECTS_DIR, SPACES_DIR,
  PDF_FILE, METADATA_FILE, BIB_FILE, SIDECAR_FILE, PAPER_NOTES_FILE, SPACE_FILE, GLOSSARY_FILE,
  joinWith, createLibraryLayout, createPaperFiles,
} from "./layout.js";
export type { Join, LibraryLayout, PaperFiles } from "./layout.js";
export * from "./paper/index.js";
export { SHARED_CONFIG_VERSION, mergeSharedConfig, parseSharedConfig, serializeSharedConfig } from "./sharedConfig.js";
export type { SharedConfig, SharedConfigUpdate } from "./sharedConfig.js";
export * from "./externalChange/index.js";
export * from "./mutations/index.js";
export * from "./model/index.js";
export * from "./folder/index.js";
export * from "./search/index.js";
export * from "./paperFiles/index.js";
export * from "./conflicts/index.js";
export * from "./syncGuide/index.js";
export * from "./readingStatus/index.js";
export * from "./writeRecords/index.js";
