// Tells the library page which paper's marks the reader changed.
import type { SidecarChange } from "@labshelf/core";
import { bx, type LibraryChangedBroadcast } from "../platform";

export function announceSidecarChange(paperId: string, change: SidecarChange): void {
  // A theme change shows nowhere in the library.
  if (change.kind === "theme") return;
  const changed: LibraryChangedBroadcast = { type: "library.changed", reason: "annotations", paperId };
  // Chrome rejects when no page is listening; that is not an error here.
  void bx.runtime.sendMessage(changed).catch(() => undefined);
}
