/**
 * The papers of the open folder as the list sees them: scoped to the folder, decorated with where each one sits,
 * narrowed by the search and the subfolder toggle, and counted per status.
 */
import { isUnderDir, parentDir, relativeFolder } from "../../library/index.js";
import { isEmptyQuery, paperMatches, searchDoc, type Query } from "../../library/search/index.js";
import type { PaperRecord } from "../../model/index.js";
import type { StatusFilter } from "../state/index.js";

const SEP = "/";

/** A paper as the list sees it: the record plus where it sits relative to the open folder. */
export interface ListPaper extends PaperRecord {
  /** Folder holding the paper (parent of `path`). */
  folderPath: string;
  /** Holder folder relative to the open folder, " / "-joined; empty when directly inside. */
  relFolder: string;
  /** Whether the paper's folder holds its PDF. */
  hasPdf: boolean;
}

const NO_PDF_DIRS: ReadonlySet<string> = new Set();

/** The papers stored under `folder`, decorated for the list; `pdfDirs` holds the record paths that have a PDF. */
export function listPapersUnder(all: readonly PaperRecord[], folder: string, pdfDirs: ReadonlySet<string> = NO_PDF_DIRS): ListPaper[] {
  return all
    .filter((p) => isUnderDir(p.path, folder, SEP) && p.path !== folder)
    .map((p) => ({ ...p, folderPath: parentDir(p.path, SEP), relFolder: relativeFolder(p.path, folder, SEP), hasPdf: pdfDirs.has(p.path) }));
}

/**
 * Papers in scope before the status tab applies, so each tab can show its own count. A search always covers the
 * whole subtree and also matches the folder path shown in the row; without one the subfolder toggle decides.
 */
export function papersInScope(papers: ListPaper[], query: Query, includeSub: boolean): ListPaper[] {
  if (isEmptyQuery(query)) return papers.filter((p) => includeSub || p.relFolder === "");
  return papers.filter((p) => paperMatches(p, searchDoc(p, { folder: p.relFolder }), query));
}

export function statusCounts(scope: ListPaper[]): Record<StatusFilter, number> {
  const counts: Record<StatusFilter, number> = { all: scope.length, unread: 0, reading: 0, done: 0 };
  for (const p of scope) counts[p.status]++;
  return counts;
}
