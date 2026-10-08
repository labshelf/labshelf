/**
 * Keeps the SQLite papers cache equal to what is on disk: scans with core, diffs against the cache, upserts what
 * changed and deletes what is gone. `reindexLibrary` also emits the paper events the list panel, the sidebar tree
 * and the AI indexer listen for, so papers that arrived (or whose PDF just showed up) appear without a reload.
 *
 * Kept out of extension.ts on purpose: extension.ts is excluded from unit tests.
 */
import { EVENTS, diffPapers } from "@labshelf/core";
import type { EventBus, LibraryScan, PaperDiff, PaperRecord } from "@labshelf/core";

/** The slice of the database the reindex reads and writes. */
export interface ReindexableDatabase {
  listPapers(): Promise<PaperRecord[]>;
  upsertPaper(paper: PaperRecord): Promise<void>;
  deletePaper(id: string): Promise<void>;
}

export interface IndexLibraryDeps {
  database: ReindexableDatabase;
  /** Reads papers/ from disk. */
  scan: () => Promise<LibraryScan>;
}

export interface ReindexLibraryDeps extends IndexLibraryDeps {
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

/**
 * Brings the cache in line with disk. A paper missing from the scan leaves the cache; its files are untouched.
 * @returns what changed
 */
export async function indexLibrary(deps: IndexLibraryDeps): Promise<PaperDiff> {
  const before = await deps.database.listPapers();
  const scan = await deps.scan();
  const diff = diffPapers(before, scan.papers.map((entry) => entry.record));
  for (const paper of [...diff.added, ...diff.updated]) { await deps.database.upsertPaper(paper); }
  for (const paper of diff.removed) { await deps.database.deletePaper(paper.id); }
  return diff;
}

/**
 * Indexes the library, then announces each change and queues the text-layer checks.
 * @returns the ids that were added, changed and removed
 */
export async function reindexLibrary(deps: ReindexLibraryDeps): Promise<ReindexSummary> {
  const diff = await indexLibrary(deps);
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
