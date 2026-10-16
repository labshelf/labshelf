/** Exports the runtime-neutral version model: snapshot names and the version.json format. */
export { versionSlug } from "./versionSlug.js";
export { parseVersionFile, serializeVersionFile, VERSIONS_DIR, VERSION_FILE, VERSION_PDF, VERSION_SOURCES } from "./versionInfo.js";
export type { VersionInfo } from "./versionInfo.js";
export type { MarkVersionRequest, ProjectVersion } from "./projectVersion.js";
