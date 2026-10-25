/** Exports the runtime-neutral version model: snapshot names, the version.json format, listing a project's snapshots and marking one, and the page comparison between two renderings of a paper. */
export { listVersions } from "./listVersions.js";
export { deriveVersionSlug } from "./deriveVersionSlug.js";
export { parseVersionFile, serializeVersionFile, VERSIONS_DIR, VERSION_FILE, VERSION_PDF, VERSION_SOURCES } from "./versionFile.js";
export type { VersionEntry } from "./versionFile.js";
export type { MarkVersionRequest, ProjectVersion } from "./projectVersion.js";
export { addProjectVersion } from "./addProjectVersion.js";
export { comparePdfPages } from "./comparePdfPages.js";
export type { PdfChanges } from "./comparePdfPages.js";
export { derivePageInk } from "./pageInk.js";
export type { PageInk } from "./pageInk.js";
