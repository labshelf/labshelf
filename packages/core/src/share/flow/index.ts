/** Exports the share-link flows the apps run behind their own pickers and dialogs, and the words they show. */
export { papersInFolder, shareableFolders, sharePaperInputs, type FolderShareSources, type ShareableFolder } from "./folderSharePapers.js";
export { shareFolderAsLink, type ShareFolderAsLinkOptions, type ShareFolderStage } from "./shareFolder.js";
export { relayBackendFor } from "./relayBackendFor.js";
export { importShareLink, type ImportShareLinkOptions, type ImportShareLinkResult } from "./importShareLink.js";
export {
  copiedLinkText, OPEN_SHARE_FAILURE, refusedShareLinkText, revokeResultText, revokeShareConfirm, SHARE_STAGE_TEXT, SHARE_WITH_ANNOTATIONS, SHARE_WITHOUT_ANNOTATIONS,
  shareFailureText, shareImportSummaryText, shareRightsNotice,
  type ShareConfirmText,
} from "./shareLinkCopy.js";
