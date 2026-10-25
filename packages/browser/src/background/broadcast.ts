// Notifies extension pages (the library page) that the library changed.
import { bx } from "../platform";
import type { LibraryChangedEvent } from "../platform";

export function sendLibraryChanged(reason: LibraryChangedEvent["reason"], paperId?: string, notice?: string): void {
  const b: LibraryChangedEvent = { type: "library.changed", reason, ...(paperId ? { paperId } : {}), ...(notice ? { notice } : {}) };
  // Chrome rejects when no page is listening; that is not an error here.
  void bx.runtime.sendMessage(b).catch(() => undefined);
}
