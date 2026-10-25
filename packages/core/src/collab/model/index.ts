/** Exports the share model: the index doc of a share and the mapping of a project folder to its docs and back. */
export {
  createShareIndexDoc, readShareIndexDocComments, readShareIndexDocFiles, readShareIndexDocSettings, readShareIndexDocKind,
  SHARE_KINDS,
  type ShareIndexDocKindResult, type ShareFileEntry, type ShareKind,
} from "./shareIndexDoc.js";
export { readFileText, setFileText } from "./readFileText.js";
export { SHARED_TOOL_FILES, deriveSharedPaths } from "./deriveSharedPaths.js";
export { isSafeSharePath } from "./safeSharePath.js";
export { deriveSharedFileKind } from "./deriveSharedFileKind.js";
export { applySharedSettings, SHARED_SETTING_KEYS, parseSharedSettings, type SharedSettings } from "./parseSharedSettings.js";
export { readSettingsMap, writeSettingsChanges, writeSettingsMap } from "./settingsMap.js";
export { mergeGeneratedBibliography, type BibliographyClash, type MergedBibliography } from "./sharedBibliography.js";
export { readWrittenVersions, addWrittenVersion, readWrittenHashes, WRITTEN_PER_PATH, type WrittenVersion } from "./writtenHistory.js";
