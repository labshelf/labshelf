/** Exports sharing: paper-folder share links (the link and manifest format, building, uploading, opening and revoking), the sharing host dialogs call and the channel that carries it, and the shared-project workflows with the ports apps implement for them. */
export { formatShareImportUri, SHARE_IMPORT_PATH, VSCODE_EXTENSION_ID } from "./shareImportUri.js";
export { formatShareLink, parseShareLink, SHARE_LINK_KEY_BYTES, SHARE_PAGE_ORIGIN } from "./shareLink.js";
export type { ShareLinkError, ShareLinkParts, ShareLinkResult } from "./shareLink.js";
export { decodeShareManifest, extractSharedMetadata, SHARE_MANIFEST_VERSION } from "./shareManifest.js";
export type { ShareManifest, SharedPaper, SharedPaperMetadata, SharedPdf, SharedPdfPart } from "./shareManifest.js";
export { BLOB_OVERHEAD_BYTES, openShareBlob, openShareManifest, sealShareBlob, sealShareManifest } from "./shareCipher.js";
export type { SealedShareBlob } from "./shareCipher.js";
export * from "./http/index.js";
export { buildShare } from "./buildShare.js";
export type { BuildShareInput, BuiltShare, SharePaperInput, SharePartLimits, StoredShareBlob } from "./buildShare.js";
export type { ShareBackend, ShareReader } from "./shareBackend.js";
export { openShare } from "./openShare.js";
export type { LoadPdfError, LoadPdfResult, OpenedShare, OpenShareError, OpenShareResult } from "./openShare.js";
export { loadShareRegistry, deriveShareLinkOfEntry, updateShareRegistry } from "./shareRegistry.js";
export type { ShareEntry, ShareRegistry, ShareRegistryStore } from "./shareRegistry.js";
export { uploadShare } from "./uploadShare.js";
export type { UploadShareOptions } from "./uploadShare.js";
export { importSharedPapers } from "./importSharedPapers.js";
export type { ImportSharedPapersOptions, SharedImportOutcome } from "./importSharedPapers.js";
export { removeShare } from "./removeShare.js";
export type { RevokeShareOptions } from "./removeShare.js";
export * from "./flow/index.js";
export type {
  ShareLinkImportResult, JoinProjectResult, ProjectShareState, ShareLinkView, ShareFolderResult, ShareProjectResult, ShareFolder, ShareHost, ShareOffers, ShareProgress, ShareProject,
} from "./libraryShareHost.js";
export { isShareMessage, parseShareCall, parseShareReply, createShareClient, serveShare, type ShareClient } from "./libraryShareMessages.js";
export type { ShareArgs, ShareCall, ShareDialogRequest, ShareOp, ShareReply } from "./libraryShareMessages.js";
export {
  createFolderShareLinkOps, createProjectShareOps, createShareHost, deriveConnectionProblem, deriveProjectName, createStoreFailureNotices,
  type FolderShareLinkDeps, type FolderShareLinkOps, type ProjectShareDeps, type ProjectShareOps, type ShareHostDeps, type NoticePlace,
} from "./projectShare.js";
export {
  joinShare, startShare, checkInvite, joinSharedProject, leaveSharedProject, startProjectShare,
  type JoinedProject, type JoinShareRequest, type StartShareRequest, type CheckedInvite, type JoinOutcome, type ShareOutcome, type ShareRequest,
} from "./projectShareFlows.js";
export {
  readCurrentInvite, offerOwnRelay, offerOwnRelayToShares, removeOwnRelayOffer, removeOwnRelayOfferFromShares, createShareResumer, isSharedProject, ShareOpenInAnotherTabError,
  type OwnRelayOffer, type ResumeReports, type ShareResumer, type SharedProject, type SharedProjectCatalog, type ShareKeyStore, type ShareConnections, type ShareFlowPorts, type StoredInvite,
} from "./sharedProjects.js";
