// The progress of a run of several cells in the run status row: 'Running k of n' with one Stop, over the single-cell display.
import type { CellRunGroup, CellRunStatus } from "./cellRunStatus.js";

/** How far a run of several cells is: `done` of `total` cells ended; `running` is the key of the cell in flight, if any. */
export interface RunProgress { readonly done: number; readonly total: number; readonly running: string | null }

/** Shows `progress` in `status` with one Stop calling `onStop`; null clears it back to the single-cell display. */
export function showRunProgress(status: CellRunStatus, progress: RunProgress | null, onStop?: () => void): void {
  status.showProgress(progress, onStop);
}

/** Shows `progress` in the row of `group` attached under `key`; a key without a row changes nothing. */
export function showGroupProgress(group: CellRunGroup, key: string, progress: RunProgress | null, onStop?: () => void): void {
  group.showProgress(key, progress, onStop);
}
