/**
 * Names the Drive sync a reader sidecar change asks the background for, so its log says what triggered it.
 */
import type { SidecarChange } from "@labshelf/core";

/**
 * @returns the sync reason for a sidecar change made from the reader.
 */
export function syncReasonFor(change: SidecarChange): string {
  return change.kind === "theme" ? "reader.theme" : "reader.annotation";
}
