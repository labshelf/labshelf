/** Exports the disk mirror of a shared project: files on disk follow the share docs and outside edits enter them. */
export { assertProjectDirReadable, createLibraryMirrorFileSystem, listMirrorFiles, MirrorProjectDirUnavailable, readStable, type MirrorFileRead, type MirrorFileSystem, type MirrorSample } from "./mirrorFileSystem.js";
export { DISK_ORIGIN, type MergeText } from "./fileReconcile.js";
export { startProjectMirror, type MirrorStopReason, type ProjectMirror, type ProjectMirrorOptions } from "./projectMirror.js";
export { openFolderLease, MirrorLostError, systemLeaseScheduler, type AcquireFolderLeaseOptions, type FolderLease, type FolderLeaseResult, type LeaseHolder, type LeaseScheduler, type MirrorApp } from "./projectLease.js";
