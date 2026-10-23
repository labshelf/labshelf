// Exposes disk-backed detection and resolution of project content copies.
export { conflictDismissalFile, findProjectConflict, scanProjectContentConflicts } from './projectConflictDetection.js';
export { resolveProjectConflictCopy, type ProjectConflictResolutionContext } from './projectConflictResolution.js';
export { readSharedProjectFiles } from './sharedProjectFiles.js';
