/**
 * Reloads the library store from disk, diffs the result against what it held before, and emits the paper events the
 * list panel, the sidebar tree and the AI indexer listen for. Local mutations and external changes (sync, a file
 * watcher) both call this, so there is exactly one reindex path.
 *
 * Kept out of extension.ts on purpose: extension.ts is excluded from unit tests.
 */
import { diffPapers } from "@labshelf/core";
import type { LibraryStore, PaperRecord } from "@labshelf/core";
import { EVENTS, EventBus } from "../../events/index.js";

export interface ReindexLibraryDeps {
  store: LibraryStore;
  eventBus: EventBus;
  // Queues a text-layer check for papers that now have a PDF but no verdict.
  queueCheck?: (papers: PaperRecord[]) => void;
}

/** Ids whose records appeared, changed or disappeared during a reindex. */
export interface ReindexSummary {
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
export async function reindexLibrary(deps: ReindexLibraryDeps): Promise<ReindexSummary> {
  const before = papersOf(deps.store);
  await deps.store.reload();
  const after = papersOf(deps.store);
  const diff = diffPapers(before, after);
  for (const paper of diff.added) { deps.eventBus.emit(EVENTS.PAPER_ADDED, paper); }
  for (const paper of diff.updated) { deps.eventBus.emit(EVENTS.PAPER_UPDATED, paper); }
  for (const paper of diff.removed) { deps.eventBus.emit(EVENTS.PAPER_DELETED, { id: paper.id }); }

  // A PDF that just arrived has no verdict yet, so let it be classified.
  const toCheck = [...diff.added, ...diff.gainedPdf].filter((paper) => paper.hasPdf !== false && !paper.textLayer);
  if (toCheck.length > 0) { deps.queueCheck?.(toCheck); }

  return {
    added: diff.added.map((paper) => paper.id),
    updated: diff.updated.map((paper) => paper.id),
    removed: diff.removed.map((paper) => paper.id),
  };
}
