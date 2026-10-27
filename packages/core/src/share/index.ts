/** Exports sharing: paper-folder share links (the link and manifest format, building, uploading, opening, revoking and importing), the sharing host dialogs call and the channel that carries it, and the shared-project workflows with the ports apps implement for them. */
export { formatShareImportUri, formatShareLink, parseShareLink, SHARE_IMPORT_PATH, SHARE_LINK_KEY_BYTES, SHARE_PAGE_ORIGIN, VSCODE_EXTENSION_ID } from "./shareLink.js";
export type { ShareLinkError, ShareLinkParts, ShareLinkResult } from "./shareLink.js";
export { decodeShareManifest, extractSharedMetadata, SHARE_MANIFEST_VERSION, BLOB_OVERHEAD_BYTES, openShareBlob, openShareManifest, sealShareBlob, sealShareManifest } from "./shareCrypto.js";
export type { ShareManifest, SharedPaper, SharedPaperMetadata, SharedPdf, SharedPdfPart, SealedShareBlob } from "./shareCrypto.js";
export { ShareRequestError, createWorkerShareBackend, createWorkerShareReader, resolveRelayBackend } from "./shareBackend.js";
export type { ShareBackend, ShareReader, WorkerShareBackendOptions, WorkerShareReaderOptions } from "./shareBackend.js";
export { buildShare, loadShareRegistry, deriveShareLinkOfEntry, updateShareRegistry, uploadShare, openShare, removeShare } from "./shareFlows.js";
export type {
  BuildShareInput, BuiltShare, SharePaperInput, SharePartLimits, StoredShareBlob, ShareEntry, ShareRegistry, ShareRegistryStore, UploadShareOptions,
  LoadPdfError, LoadPdfResult, OpenedShare, OpenShareError, OpenShareResult, RevokeShareOptions,
} from "./shareFlows.js";
export { importSharedPapers, importShareLink } from "./shareImport.js";
export type { ImportSharedPapersOptions, SharedImportOutcome, ImportShareLinkOptions, ImportShareLinkResult } from "./shareImport.js";
export {
  listPapersInFolder, listShareableFolders, createSharePaperInputs, createShareLink,
  describeCopiedShareLink, OPEN_SHARE_FAILURE, describeRefusedShareLink, describeRevokeShareOutcome, describeRevokeShareNotice, SHARE_STAGE_TEXT, SHARE_WITH_ANNOTATIONS, SHARE_WITHOUT_ANNOTATIONS,
  describeShareFailure, describeSharedImport, describeShareRightsNotice,
} from "./folderShare.js";
export type { FolderShareSources, ShareableFolder, CreateShareLinkOptions, ShareFolderStage, ShareNoticeText } from "./folderShare.js";
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
