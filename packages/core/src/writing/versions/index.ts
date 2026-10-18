/** Exports the runtime-neutral version model: snapshot names, the version.json format, listing a project's snapshots and marking one. */
export { listVersions } from "./listVersions.js";
export { versionSlug } from "./versionSlug.js";
export { parseVersionFile, serializeVersionFile, VERSIONS_DIR, VERSION_FILE, VERSION_PDF, VERSION_SOURCES } from "./versionInfo.js";
export type { VersionInfo } from "./versionInfo.js";
export type { MarkVersionRequest, ProjectVersion } from "./projectVersion.js";
export { markVersion } from "./markVersion.js";
