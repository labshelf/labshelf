/** Exports the disk mirror of a shared project: files on disk follow the share docs and outside edits enter them. */
export { libraryMirrorDisk, listMirrorFiles, MirrorRootUnavailable, type DiskRead, type MirrorDisk } from "./fileSystem/index.js";
export { DISK_ORIGIN, type MergeText } from "./mirrorContext.js";
export { startProjectMirror, type MirrorStopReason, type ProjectMirror, type ProjectMirrorOptions } from "./projectMirror.js";
export { acquireFolderLease, type AcquireFolderLeaseOptions, type FolderLeaseResult } from "./openProjectLease.js";
export type { FolderLease } from "./projectLease.js";
export type { LeaseHolder, MirrorApp } from "./leaseFile.js";
export { systemLeaseScheduler, type LeaseScheduler } from "./mirrorScheduler.js";
export { MirrorOwnershipLost } from "./mirrorLostError.js";
