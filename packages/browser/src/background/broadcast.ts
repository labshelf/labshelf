// Notifies extension pages (the library page) that the library changed.
import { bx } from "../platform";
import type { LibraryChangedBroadcast } from "../platform";

export function broadcastChanged(reason: LibraryChangedBroadcast["reason"], paperId?: string): void {
  const b: LibraryChangedBroadcast = { type: "library.changed", reason, ...(paperId ? { paperId } : {}) };
  // Chrome rejects when no page is listening; that is not an error here.
  void bx.runtime.sendMessage(b).catch(() => undefined);
}
