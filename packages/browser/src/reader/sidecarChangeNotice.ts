// Tells the library page which paper's marks the reader changed.
import type { SidecarChange } from "@labshelf/core";
import { bx, type LibraryChangedEvent } from "../platform";

export function sendSidecarChange(paperId: string, change: SidecarChange): void {
  // A theme change shows nowhere in the library.
  if (change.kind === "theme") return;
  const changed: LibraryChangedEvent = { type: "library.changed", reason: "annotations", paperId };
  // Chrome rejects when no page is listening; that is not an error here.
  void bx.runtime.sendMessage(changed).catch(() => undefined);
}
