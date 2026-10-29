/** Compares an origin's recorded hash with the manuscript's current text and the note's current equation. */
import type { ManuscriptOrigin } from "./scanOrigins.js";

export type OriginState = "fresh" | "stale" | "diverged" | "both" | "missing";

/** `note` is undefined when the note or its label is gone. */
export function deriveOriginState(origin: ManuscriptOrigin, manuscriptHash: string, note: { hash: string } | undefined): OriginState {
  if (!note) { return "missing"; }
  const manuscriptChanged = manuscriptHash !== origin.hash;
  const noteChanged = note.hash !== origin.hash;
  if (manuscriptChanged && noteChanged) { return "both"; }
  if (noteChanged) { return "stale"; }
  if (manuscriptChanged) { return "diverged"; }
  return "fresh";
}
