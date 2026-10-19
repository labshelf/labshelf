// Exports the browser side of a shared project: joining it over a relay, its disk mirror, its stored keys, and the editor binding and live comments.
export { collabExtensions } from "./binding";
export { createLiveCommentThreads } from "./liveCommentThreads";
export { startDocFileWriter, type DocFileWriter } from "./docFileWriter";
export { joinSharedProject, UnknownShareKindError } from "./joinSharedProject";
export { loadDisplayName, loadShare, saveDisplayName, saveShare } from "./shareKeyStore";
export { createPageShares, type PageShares } from "./pageShares";
export { runJoinDialog } from "./joinDialog";
export type { ShareConnection } from "./shareConnection";
