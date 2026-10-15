// Barrel for persisted sync bookkeeping: the manifest, the last-run record, and the cross-process lock.
export { SyncManifest } from "./syncManifest.js";
export { summarizeSyncResult, writeSyncRunRecord, readSyncRunRecord } from "./syncRunRecord.js";
export type { SyncRunRecord } from "./syncRunRecord.js";
export { SyncLock, parseSyncLock } from "./syncLock.js";
export type { SyncLockOwner, SyncLockInfo, SyncLockOptions, SyncLockAttempt } from "./syncLock.js";
