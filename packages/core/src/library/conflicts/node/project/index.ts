// Exposes disk-backed detection and resolution of project content copies.
export { conflictDismissalFile, findProjectConflict, scanProjectContentConflicts, type ProjectConflictLocation } from './projectConflictDetection.js';
export { resolveProjectConflictCopy, type ProjectConflictResolutionContext } from './projectConflictResolution.js';
export { readSharedProjectFiles } from './sharedProjectFiles.js';
export { readSharedProjectVersions } from './sharedProjectVersions.js';
