/** Exports the share session and its docs: the index doc, the file mapping, text binding with own-only undo, comment threads and binary file exchange. */
export { createShareSession, INDEX_DOC_KEY, type ShareSession, type ShareSessionOptions } from "./docSync.js";
export { attachShareBlobs, BLOB_CHUNK_BYTES, MAX_BLOB_BYTES, ShareBlobFetchError, type ShareBlobExchange, type ShareBlobFetchErrorCode, type ShareBlobsOptions } from "./shareBlobs.js";
export { NormalizedText, type EditorSelection, type PendingChange, type TextChange } from "./textBinding.js";
export { derivePeerColour, deriveAbsoluteSelection, deriveRelativeSelection, type RelativeSelection, type TextSelection } from "./cursors.js";
export { TextUndoManager, type UndoSelection } from "./textUndoManager.js";
export {
  addThread, COMMENTS_PATH, deriveCommentThreads, parseCommentsFile, addThreadReply, serializeCommentsFile, setThreadResolved,
  createSharedProjectComments, importCommentsFile, loadCommentsDocument, renderCommentsFile, updateCommentsDocument,
  type CommentsDocument, type CommentsFileAccess, type SharedProjectComments,
} from "./commentsFile.js";
export {
  addLiveThread, addLiveThreadReply, deriveAnchor, deriveLiveAnchor, findThread, readLiveThreads, setLiveThreadResolved,
  type Comment, type CommentAnchor, type CommentThread, type TextRange,
} from "./comments.js";
export {
  createShareIndexDoc, readShareIndexDocComments, readShareIndexDocFiles, readShareIndexDocSettings, readShareIndexDocKind,
  SHARE_KINDS, readWrittenVersions, addWrittenVersion, readWrittenHashes, WRITTEN_PER_PATH,
  type ShareIndexDocKindResult, type ShareFileEntry, type ShareKind, type WrittenVersion,
} from "./shareIndexDoc.js";
export {
  SHARED_TOOL_FILES, deriveSharedPaths, isSafeSharePath, deriveSharedFileKind, readFileText, setFileText,
  applySharedSettings, SHARED_SETTING_KEYS, parseSharedSettings, readSettingsMap, writeSettingsChanges, writeSettingsMap,
  mergeGeneratedBibliography,
  type BibliographyClash, type MergedBibliography, type SharedSettings,
} from "./sharedFiles.js";
