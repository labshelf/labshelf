/** Exports the runtime-neutral version model: snapshot names, the version.json format, listing a project's snapshots and marking one, and the page comparison between two renderings of a paper. */
export { listVersions } from "./listVersions.js";
export { versionSlug } from "./versionSlug.js";
export { parseVersionFile, serializeVersionFile, VERSIONS_DIR, VERSION_FILE, VERSION_PDF, VERSION_SOURCES } from "./versionFile.js";
export type { VersionInfo } from "./versionFile.js";
export type { MarkVersionRequest, ProjectVersion } from "./projectVersion.js";
export { markVersion } from "./markVersion.js";
export { diffPages } from "./diffPages.js";
export type { PdfChanges } from "./diffPages.js";
export { inkMapFromRgba } from "./pageInk.js";
export type { InkMap } from "./pageInk.js";
