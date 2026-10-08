/**
 * View derivations for the library page: the list rows with their search text, the status tabs and the sort
 * wiring. Path and tree logic lives in core. Everything here is side-effect free.
 */
import {
  PAPER_STATUSES, PAPERS_DIR, isUnderDir, parentDir, recordComparator, relativeFolder,
  type PaperRecord, type PaperSortKey, type PaperStatus, type FolderTreeNode,
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
  /** Lower-cased haystack for token search. */
  hay: string;
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
      const hay = [p.title, (p.authors ?? []).join(" "), p.year, p.citeKey, p.journal, p.publisher, (p.keywords ?? []).join(" "), relFolder]
        .join(" ").toLowerCase();
      return { ...p, folderPath, relFolder, hay, hasPdf: pdfDirs.has(p.path) };
    });
}

/**
 * Papers in scope before the status tab is applied, so each tab can show its
 * own count. A search always covers the whole subtree; without one the
 * subfolder toggle decides.
 */
export function papersInScope(papers: ListPaper[], tokens: string[], includeSub: boolean): ListPaper[] {
  return papers.filter((p) => tokens.length ? tokens.every((t) => p.hay.includes(t)) : includeSub || p.relFolder === "");
}

export function statusCounts(scope: ListPaper[]): Record<StatusFilter, number> {
  const counts: Record<StatusFilter, number> = { all: scope.length, unread: 0, reading: 0, done: 0 };
  for (const p of scope) counts[p.status]++;
  return counts;
}

export function lastName(author: string): string {
  return author.trim().split(" ").pop() ?? author;
}

/** "Smith", "Smith, Lee" or "Smith et al." — the Creator column. */
export function fmtCreator(authors: string[] | undefined): string {
  if (!authors || authors.length === 0) return "";
  if (authors.length === 1) return authors[0]!;
  return authors.length > 2 ? `${lastName(authors[0]!)} et al.` : authors.map(lastName).join(", ");
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
