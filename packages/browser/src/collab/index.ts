// Exports the browser side of a shared project: the page's sharing and its resume reports, the editor binding and the page-write report.
export { collabExtensions } from "./binding";
export { resumeReports } from "./resumeReports";
export { reportPageWrites, onLocalFileChanges } from "./mirror";
export { createPageShares, DEFAULT_DISPLAY_NAME, type PageShares } from "./pageShares";
export { createPageSharing, type PageSharing } from "./pageShare";
export { createShareKeyStore, loadDisplayName, saveDisplayName } from "./shareKeyStore";
