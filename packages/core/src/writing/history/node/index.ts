/** Exports the Node side of project history and versions: disk storage, the target of a project folder, the marked-up PDF between two versions and the comparison of two PDFs. */
export { createNodeHistoryStorage, createNodeHistoryProject } from "./historyStorage.js";
export { buildMarkedUpDiff, comparePdfs } from "./versionDiff.js";
export type { DiffRequest } from "./versionDiff.js";
