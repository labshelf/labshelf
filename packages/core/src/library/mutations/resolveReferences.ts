// Resolves paper ids to the folders a batch mutation acts on, through the app's own index lookup.
import type { PaperRecord } from "../../model/index.js";
import type { BatchOutcome, Reference } from "./mutationDeps.js";

/** What an app's index knows about one paper: its folder, and its record when the index holds one. */
export interface PaperHit {
  path: string;
  record?: PaperRecord;
}

/** A found paper; core mutations accept it as a PaperRef. */
export interface ResolvedReference extends Reference {
  record?: PaperRecord;
}

/**
 * Looks up each id in order; the lookup owns the app's policy, such as rescanning the disk on a miss.
 * @returns the found papers, and a "Paper not found" failure for each id the lookup does not know
 */
export async function resolveReferences(
  ids: readonly string[],
  lookup: (id: string) => Promise<PaperHit | undefined>,
): Promise<{ refs: ResolvedReference[]; failed: BatchOutcome["failed"] }> {
  const refs: ResolvedReference[] = [];
  const failed: BatchOutcome["failed"] = [];
  for (const id of ids) {
    const hit = await lookup(id);
    if (hit) { refs.push({ id, ...hit }); } else { failed.push({ id, error: "Paper not found" }); }
  }
  return { refs, failed };
}
