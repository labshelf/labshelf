/** Exports the library domain's public API: collection folders, paper metadata and the on-disk layout. */
export { relocatePapersUnder, removePapersUnder } from "./paperRecordReindex.js";
export type { IPaperRecordIndex } from "./paperRecordReindex.js";
export { paperRecordFromMetadata, parsePaperMetadata } from "./paperMetadata.js";
export type { PaperLocation } from "./paperMetadata.js";
export {
  PAPERS_DIR, RESEARCH_DIR, APPDATA_DIR, PROJECTS_DIR,
  PDF_FILE, METADATA_FILE, BIB_FILE, SIDECAR_FILE,
  AI_DATABASE_FILE, APP_LOG_FILE, TERMINAL_LOG_FILE, PROJECT_REGISTRY_FILE,
  SYNC_PROVIDER_ID, BROWSER_SYNC_ROOTS,
  joinWith, libraryLayout, paperFiles, syncRoots,
} from "./layout.js";
export type { Join, LibraryLayout, PaperFiles } from "./layout.js";
export {
  FOLDER_NAME_MAX_LENGTH,
  citeKeySlug, claimCiteKey, editedTags, makeCiteKey, normalizeTags, titleKey, uniqueCiteKey, validateFolderName,
} from "./identity/index.js";
export type { CiteKeyMetadata } from "./identity/index.js";
export { SHARED_CONFIG_VERSION, mergeSharedConfig, parseSharedConfig, serializeSharedConfig } from "./sharedConfig.js";
export type { SharedConfig, SharedConfigPatch } from "./sharedConfig.js";
export * from "./format/index.js";
export * from "./externalChange/index.js";
export * from "./mutations/index.js";
export * from "./model/index.js";
export * from "./scan/index.js";
export * from "./search/index.js";
