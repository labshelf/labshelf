/** Exports end-to-end encrypted collaboration on a share. */
export * from "./invite/index.js";
export * from "./relays/index.js";
export * from "./mirror/index.js";
export * from "./session/index.js";
export { readQmdDoc, readQmdDocText, setQmdDocText } from "../qmd/index.js";

// The encrypted peer mesh a share session runs its channels over, the wire format of its messages, and the presence shared over it.
export { createSecureMesh } from "./peerMesh.js";
export {
  ACK_DELAY_MS, CHANNEL_KIND, createDocIdCache, decodeEnvelope, deriveDocId, DOC_ID_BYTES, encodeEnvelope, ENVELOPE_HEADER_BYTES,
  ENVELOPE_VERSION, EXTENSION_KIND_MIN, MAX_SEND_ATTEMPTS, MESSAGE_KIND, openDocFrame, RESEND_AFTER_MS, sealDocFrame, startInterval,
  systemScheduler,
} from "./channel.js";
export type { Channel, ChannelSpec, Envelope, EnvelopeResult, PeerId, PeerMesh, PeerTransport, SessionPhase, SessionScheduler } from "./channel.js";
export { attachPresence, isPeerPresence } from "./presence.js";
export type { PresenceOptions, PresenceState, PresenceStore, RelayReport } from "./presence.js";

// The share session and its docs: the index doc, the file mapping, text binding with own-only undo, comment threads and binary file exchange.
export { createShareSession, INDEX_DOC_KEY, type ShareSession, type ShareSessionOptions } from "./docSync.js";
export { attachShareBlobs, BLOB_CHUNK_BYTES, MAX_BLOB_BYTES, ShareBlobFetchError, type ShareBlobExchange, type ShareBlobFetchErrorCode, type ShareBlobsOptions } from "./shareBlobs.js";
export { NormalizedText, type EditorSelection, type PendingChange, type TextChange } from "./textBinding.js";
export { derivePeerColour, deriveAbsoluteSelection, deriveRelativeSelection, type RelativeSelection, type TextSelection } from "./cursors.js";
export { TextUndoManager, type UndoSelection } from "./textUndoManager.js";
export {
  addThread, COMMENTS_PATH, deriveCommentThreads, addThreadReply, setThreadResolved,
  createSharedProjectComments, importCommentsFile, loadCommentsDocument, renderCommentsFile, updateCommentsDocument,
  type CommentsDocument, type CommentsFileAccess, type SharedProjectComments,
} from "./commentsFile.js";
export { parseCommentsQmd, serializeCommentsQmd, threadsToItems } from "./commentsQmd.js";
export {
  addLiveThread, addLiveThreadReply, createEditorCommentRange, deriveAnchor, deriveLiveAnchor, deriveOffset, derivePosition, findSourceCommentRange,
  findThread, readLiveThreads, setLiveThreadResolved,
  type Comment, type CommentAnchor, type CommentThread, type LinePosition, type TextRange,
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
