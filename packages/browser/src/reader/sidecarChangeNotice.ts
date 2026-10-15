/**
 * Reacts to the reader changing a paper's sidecar: asks the background to sync soon, and tells the library page to refresh
 * that paper's marks. A theme change shows nowhere in the library, so only the sync hears of it.
 */
import type { SidecarChange } from "@labshelf/core";
import { bx, type LibraryChangedBroadcast, type RuntimeMessage } from "../platform";
import { syncReasonFor } from "./readerSyncReason";

export function announceSidecarChange(paperId: string, change: SidecarChange): void {
  const sync: RuntimeMessage = { type: "sync.scheduleSoon", reason: syncReasonFor(change) };
  void bx.runtime.sendMessage(sync).catch(() => undefined);
  if (change.kind === "theme") return;
  const changed: LibraryChangedBroadcast = { type: "library.changed", reason: "annotations", paperId };
  // Chrome rejects when no page is listening; that is not an error here.
  void bx.runtime.sendMessage(changed).catch(() => undefined);
}
