/** Public surface of the sync coordinator every app drives. */
export { SyncCoordinator } from "./syncCoordinator.js";
export { libraryChanged } from "./libraryChanged.js";
export type { SyncStatusListener } from "./syncStatus.js";
export type {
  SyncAuthGate,
  SyncCoordinatorDeps,
  SyncOutcome,
  SyncState,
  SyncStatus,
  SyncTarget,
  SyncTimerId,
  SyncTimers,
} from "./types.js";
