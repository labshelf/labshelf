// Exports the browser side of a shared project: the page's sharing and its resume reports, the comment threads and their editor marks, the editor binding, the share list and the page-write report.
export { createCommentSupport, createCommentThreads, createRoutedCommentThreads, type EditorComments, type CommentThreads, type LocatedThread } from "./comments";
export { onLocalFileChanges, reportPageWrites } from "./mirror";
export { createPageShare, createPageShares, createResumeReports, DEFAULT_DISPLAY_NAME, type PageShare, type PageShares } from "./pageShares";
export { createCollabExtensions } from "./register";
export { createBrowserShareRegistryStore } from "./shareRegistry";
export { createShareKeyStore, readMemberName, writeMemberName } from "./keys";
