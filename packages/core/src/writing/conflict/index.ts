// Exposes project text history and the detection of project text copies.
export { FileProjectVersionStore } from "./projectVersions.js";
export { detectProjectConflict, isEligibleProjectConflictPath, VERSION_SIMILARITY, type ProjectConflictText, type ProjectConflictInput } from "./projectConflicts.js";
