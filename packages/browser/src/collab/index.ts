// Exports the browser side of a shared project: the page's sharing and its resume reports, the editor binding and the page-write report.
export { createCollabExtensions } from "./createCollabExtensions";
export { createResumeReports } from "./createResumeReports";
export { reportPageWrites, onLocalFileChanges } from "./mirror";
export { createPageShares, DEFAULT_DISPLAY_NAME, type PageShares } from "./pageShares";
export { createPageShare, type PageShare } from "./pageShare";
export { createShareKeyStore, readMemberName, writeMemberName } from "./shareKeyStore";
