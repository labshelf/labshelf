/** Exports the public API of the sync coordinator every app drives. */
export { SyncCoordinator } from "./syncCoordinator.js";
export { diskSyncTarget, type DiskSyncTargetOptions } from "./diskSyncTarget.js";
export { libraryChanged } from "./libraryChanged.js";
export type { SyncStatusListener } from "./syncStatus.js";
export {
  SKIP_NOT_SIGNED_IN,
  type SyncAuthGate,
  type SyncCoordinatorDeps,
  type SyncOutcome,
  type SyncState,
  type SyncStatus,
  type SyncTarget,
  type SyncTimerId,
  type SyncTimers,
} from "./types.js";
