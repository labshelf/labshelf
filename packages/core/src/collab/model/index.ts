/** Exports the share model: the index doc of a share and the mapping of a project folder to its docs and back. */
export {
  createProjectIndex, indexComments, indexFiles, indexSettings, readIndexKind,
  SHARE_KINDS,
  type IndexKindResult, type ShareFileEntry, type ShareKind,
} from "./shareIndexDoc.js";
export { fileText, replaceFileText } from "./fileText.js";
export { SHARED_TOOL_FILES, sharedPaths } from "./sharedPaths.js";
export { isSafeSharePath } from "./safeSharePath.js";
export { sharedFileKind } from "./sharedFileKind.js";
export { applySharedSettings, SHARED_SETTING_KEYS, sharedSettings, type SharedSettings } from "./sharedSettings.js";
export { readSettingsMap, writeSettingsChanges, writeSettingsMap } from "./settingsMap.js";
export { mergeGeneratedBibliography, type BibliographyClash, type MergedBibliography } from "./sharedBibliography.js";
export { indexWritten, recordWritten, writtenHashes, WRITTEN_PER_PATH, type WrittenVersion } from "./writtenHistory.js";
