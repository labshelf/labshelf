// Reloads the library store from disk, diffs it against the previous state and emits paper events.
// Local mutations and external changes share this single reindex path; it lives outside extension.ts, which tests exclude.
import { comparePapers } from "@labshelf/core";
import type { LibraryStore, PaperRecord } from "@labshelf/core";
import type { LibraryEvents } from "../library/index.js";

export interface ReindexLibraryDeps {
  store: LibraryStore;
  events: LibraryEvents;
  // Queues a text-layer check for papers that have a PDF but no verdict.
  queueCheck?: (papers: PaperRecord[]) => void;
}

/** Ids whose records appeared, changed or disappeared during a reindex. */
export interface RefreshLibraryResult {
  added: string[];
  updated: string[];
  removed: string[];
}

function papersOf(store: LibraryStore): PaperRecord[] {
  return [...store.snapshot.papers.values()].map((entry) => entry.record);
}

/**
 * Reloads the store, then announces each change and queues the text-layer checks.
 * @returns the ids that were added, changed and removed
 */
export async function refreshLibrary(deps: ReindexLibraryDeps): Promise<RefreshLibraryResult> {
  const before = papersOf(deps.store);
  await deps.store.reload();
  const after = papersOf(deps.store);
  const diff = comparePapers(before, after);
  for (const paper of diff.added) { deps.events.paperAdded.fire(paper); }
  for (const paper of diff.updated) { deps.events.paperUpdated.fire(paper); }
  for (const paper of diff.removed) { deps.events.paperDeleted.fire({ id: paper.id }); }

  // A PDF that just arrived has no verdict yet, so let it be classified.
  const toCheck = [...diff.added, ...diff.gainedPdf].filter((paper) => paper.hasPdf !== false && !paper.textLayer);
  if (toCheck.length > 0) { deps.queueCheck?.(toCheck); }

  return {
    added: diff.added.map((paper) => paper.id),
    updated: diff.updated.map((paper) => paper.id),
    removed: diff.removed.map((paper) => paper.id),
  };
}
