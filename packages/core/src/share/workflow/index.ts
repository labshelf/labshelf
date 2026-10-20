/** Exports the share-link workflows the apps run behind their own pickers and dialogs, and the words they show. */
export { papersInFolder, shareableFolders, sharePaperInputs, type FolderShareSources, type ShareableFolder } from "./folderSharePapers.js";
export { shareFolderAsLink, type SharedFolderLink, type ShareFolderAsLinkOptions, type ShareFolderStage, type ShareFolderSummary } from "./shareFolderAsLink.js";
export { relayBackendFor } from "./relayBackendFor.js";
export { importShareLink, type ImportShareLinkOptions, type ImportShareLinkResult } from "./importShareLink.js";
export {
  OPEN_SHARE_FAILURE, refusedShareLinkText, revokeShareConfirm, SHARE_WITH_ANNOTATIONS, SHARE_WITHOUT_ANNOTATIONS, shareImportSummaryText, shareRightsNotice,
  type ShareConfirmText,
} from "./shareLinkCopy.js";
