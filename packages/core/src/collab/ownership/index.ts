/** Exports the folder lease that lets one mirror at a time write a project folder. */
export { acquireFolderLease, type AcquireFolderLeaseOptions, type FolderLeaseResult } from "./acquireFolderLease.js";
export type { FolderLease } from "./heldFolderLease.js";
export type { LeaseHolder, MirrorApp } from "./leaseFile.js";
export { systemLeaseScheduler, type LeaseScheduler } from "./leaseScheduler.js";
export { MirrorOwnershipLost } from "./mirrorOwnershipLost.js";
