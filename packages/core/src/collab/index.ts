/** Exports end-to-end encrypted collaboration on a share: the invite link that hands a share key and its relays to a new member, the share keys and frames it carries, and the identities and sealed invites that carry it to one person. */
export {
  PUBLIC_KEY_BYTES, canonicalJson, decodePublicKey, exportIdentity, fingerprint, generateIdentity, importIdentity, publicKeys, signObject, verifyObject,
} from "./identity.js";
export type { Identity, IdentityJwk, IdentityJwkPair, IdentityKey, IdentityKeyPair, IdentityPublicKeys, JsonObject, JsonValue } from "./identity.js";
export { INVITE_LIFETIME_MS, SealedInviteError, openInvite, sealInvite } from "./sealedInvite.js";
export type {
  OpenInviteOptions, SealInviteInput, SealedInviteEnvelope, SealedInviteErrorReason, SealedInvitePayload, SenderCard,
} from "./sealedInvite.js";
export { assertInviteHasRelay, formatInvite, InviteWithoutRelayError, isHttpsUrl, parseInvite } from "./invite.js";
export type { Invite, InviteError, InviteRelay, ParseInviteResult } from "./invite.js";
export {
  SHARE_KEY_BYTES, createNextShareKey, createShareKey, deriveContentShareKey, derivePresenceShareKey, deriveRelayToken, deriveShareId,
  openFrame, sealFrame,
} from "../shareKey/index.js";
export type { DerivedShareKey, FrameContext, FrameError, OpenResult, ShareSecret } from "../shareKey/index.js";
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
export type { ConversationPresence, PresenceOptions, PresenceState, PresenceStore, RelayReport } from "./presence.js";

// The share session and its docs: the index doc, the file mapping, text binding with own-only undo, comment threads and binary file exchange.
export { createShareSession, INDEX_DOC_KEY, type ShareSession, type ShareSessionOptions } from "./docSync.js";
export { attachShareBlobs, BLOB_CHUNK_BYTES, MAX_BLOB_BYTES, ShareBlobFetchError, type ShareBlobExchange, type ShareBlobFetchErrorCode, type ShareBlobsOptions } from "./shareBlobs.js";
export { NormalizedText, type EditorSelection, type PendingChange, type TextChange } from "./textBinding.js";
export { derivePeerColour, deriveAbsoluteSelection, deriveRelativeSelection, type RelativeSelection, type TextSelection } from "./cursors.js";
export { TextUndoManager, type UndoSelection } from "./textUndoManager.js";
export {
  addThread, COMMENTS_PATH, deriveCommentThreads, addThreadReply, setThreadResolved, deriveSuggestions, addSuggestions, removeSuggestions,
  createSharedProjectComments, importCommentsFile, loadCommentsDocument, renderCommentsFile, updateCommentsDocument,
  type CommentsDocument, type CommentsFileAccess, type SharedProjectComments,
} from "./commentsFile.js";
export { parseCommentsQmd, serializeCommentsQmd, threadsToItems } from "./commentsQmd.js";
export {
  createSharedProjectSuggestions, deriveSuggestionAnchor, findSuggestion, readSuggestion, resolveSuggestionText,
  toFileSuggestion, toSuggestion, type EditorSuggestions, type FileSuggestion, type ReviewMode, type SharedProjectSuggestions, type Suggestion, type SuggestionKind,
} from "./suggestions.js";
export {
  addLiveThread, addLiveThreadReply, createEditorCommentRange, deriveAnchor, deriveLiveAnchor, deriveOffset, derivePosition, findSourceCommentRange,
  findThread, readLiveThreads, setLiveThreadResolved, toThreadRange,
  type Comment, type CommentAnchor, type CommentThread, type LinePosition, type TextRange, type ThreadRange,
} from "./comments.js";
export {
  createShareIndexDoc, readShareIndexDocComments, readShareIndexDocFiles, readShareIndexDocSettings, readShareIndexDocKind,
  SHARE_KINDS, readWrittenVersions, addWrittenVersion, readWrittenHashes, WRITTEN_PER_PATH,
  type ShareIndexDocKindResult, type ShareFileEntry, type ShareKind, type WrittenVersion,
} from "./shareIndexDoc.js";
export {
  SHARED_TOOL_FILES, PROJECT_CHAT_PATH, deriveSharedPaths, isSafeSharePath, deriveSharedFileKind, readFileText, setFileText,
  applySharedSettings, SHARED_SETTING_KEYS, parseSharedSettings, readSettingsMap, writeSettingsChanges, writeSettingsMap,
  mergeGeneratedBibliography,
  type BibliographyClash, type MergedBibliography, type SharedSettings,
} from "./sharedFiles.js";

// The shared part of a Space's JSON files in a share's index, merged by key and entry.
export {
  applySharedJson, hasSharedJson, isSameSharedJson, readSharedJson, readSharedJsonDoc, writeSharedJsonDoc,
  type SharedJson, type SharedJsonCollection, type SharedJsonSpec,
} from "./sharedJson.js";

// The member cards in a share and the contacts a library keeps from them, which invitations by email use.
export {
  addMemberContacts, readMembers, removeOwnCard, signCard, writeOwnCard,
  type Contact, type ContactsStore,
} from "./members.js";
