/** Exports the disk mirror of a shared project: files on disk follow the share docs and outside edits enter them. */
export { libraryMirrorDisk, listMirrorFiles, MirrorRootUnavailable, type DiskRead, type MirrorDisk } from "./disk/index.js";
export { DISK_ORIGIN, type MergeText } from "./reconcile/index.js";
export { startProjectMirror, type MirrorStopReason, type ProjectMirror, type ProjectMirrorOptions } from "./projectMirror.js";
