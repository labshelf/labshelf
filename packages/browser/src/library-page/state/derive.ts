/**
 * View derivations for the library page: the list rows, the search scope, the status tabs and the sort
 * wiring. Path and tree logic lives in core. Everything here is side-effect free.
 */
import {
  PAPER_STATUSES, PAPERS_DIR, isEmptyQuery, isUnderDir, paperMatches, parentDir, recordComparator, relativeFolder, searchDoc,
  type FolderTreeNode, type PaperRecord, type PaperSortKey, type PaperStatus, type Query,
} from "@labshelf/core";
import type { SortDir, SortKey, StatusFilter } from "./libraryStore";

export const ROOT = PAPERS_DIR;
export const STATUSES: readonly PaperStatus[] = PAPER_STATUSES;
export const STATUS_LABEL: Record<PaperStatus, string> = { unread: "Unread", reading: "Reading", done: "Done" };
const SEP = "/";

/** A paper as the list sees it: the record plus where it sits relative to the open folder. */
export interface ListPaper extends PaperRecord {
  /** Folder holding the paper (parent of `path`). */
  folderPath: string;
  /** Holder folder relative to the open folder, " / "-joined; empty when directly inside. */
  relFolder: string;
  /** Whether `${path}/paper.pdf` exists on this device (from the store's pdfDirs). */
  hasPdf: boolean;
}

/** Shared empty set so callers that do not track PDF presence (counts) need not build one. */
const NO_PDF_DIRS: ReadonlySet<string> = new Set();

/** Every folder path in the tree, parents before children, labelled by the path below the root. */
export function flattenFolders(tree: FolderTreeNode[]): Array<{ label: string; path: string }> {
  const out: Array<{ label: string; path: string }> = [];
  const walk = (nodes: FolderTreeNode[]): void => {
    for (const n of nodes) { out.push({ label: n.path.slice(ROOT.length + 1).split(SEP).join(" / "), path: n.path }); walk(n.children); }
  };
  walk(tree);
  return out;
}

/**
 * The papers stored under `folder`, decorated for the list. `pdfDirs` carries
 * the record paths whose folder holds a paper.pdf (the store's slice); it
 * defaults to empty for callers that only count papers and ignore presence.
 */
export function listPapersUnder(all: PaperRecord[], folder: string, pdfDirs: ReadonlySet<string> = NO_PDF_DIRS): ListPaper[] {
  return all
    .filter((p) => isUnderDir(p.path, folder, SEP) && p.path !== folder)
    .map((p) => {
      const folderPath = parentDir(p.path, SEP);
      const relFolder = relativeFolder(p.path, folder, SEP);
      return { ...p, folderPath, relFolder, hasPdf: pdfDirs.has(p.path) };
    });
}

/**
 * Papers in scope before the status tab is applied, so each tab can show its
 * own count. A search always covers the whole subtree and also matches the
 * folder path shown in the row; without one the subfolder toggle decides.
 */
export function papersInScope(papers: ListPaper[], query: Query, includeSub: boolean): ListPaper[] {
  if (isEmptyQuery(query)) { return papers.filter((p) => includeSub || p.relFolder === ""); }
  return papers.filter((p) => paperMatches(p, searchDoc(p, { folder: p.relFolder }), query));
}

export function statusCounts(scope: ListPaper[]): Record<StatusFilter, number> {
  const counts: Record<StatusFilter, number> = { all: scope.length, unread: 0, reading: 0, done: 0 };
  for (const p of scope) counts[p.status]++;
  return counts;
}

export function nextStatus(status: PaperStatus): PaperStatus {
  return STATUSES[(STATUSES.indexOf(status) + 1) % STATUSES.length]!;
}

const CORE_SORT_KEY: Record<SortKey, PaperSortKey> = {
  title: "title", creator: "author", year: "year", publication: "publication", status: "status",
};

/** Sorts by the chosen column with title as the tiebreaker. Returns a new array. */
export function sortPapers(papers: ListPaper[], key: SortKey, dir: SortDir): ListPaper[] {
  // Core orders years newest first; the ascending arrow (dir 1) means oldest first, so year reads the direction the other way round.
  const reverse = key === "year" ? dir === 1 : dir === -1;
  return [...papers].sort(recordComparator({ key: CORE_SORT_KEY[key], reverse }));
}
