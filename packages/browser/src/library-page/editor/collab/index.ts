// Exports the browser side of a shared project: joining it over a relay, its disk mirror, its stored keys, and the editor binding and live comments.
export { collabExtensions, type CollabExtensionsOptions } from "./binding";
export { createLiveCommentThreads, type LiveCommentThreadsOptions } from "./liveCommentThreads";
export { startDocFileWriter, type DocFileWriter, type DocFileWriterOptions } from "./docFileWriter";
export { joinSharedProject, UnknownShareKindError, type JoinedSharedProject, type JoinSharedProjectOptions } from "./joinSharedProject";
export { connectShare, type ConnectShareOptions, type ShareConnection } from "./shareConnection";
export { loadDisplayName, loadShare, saveDisplayName, saveShare, type StoredShare } from "./shareKeyStore";
export { createPageShares, type ActiveShare, type PageShares, type PageSharesOptions } from "./pageShares";
export { runJoinDialog, type JoinDialogOptions } from "./joinDialog";
