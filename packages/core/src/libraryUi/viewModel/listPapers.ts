/**
 * Lists the open folder's papers as the list sees them: scoped to the folder, decorated with where each one sits,
 * and narrowed by the search.
 */
import { isUnderDir, parentDir, relativeFolder } from "../../library/index.js";
import { isEmptyQuery, paperMatches, searchDoc, type Query } from "../../library/search/index.js";
import type { PaperRecord } from "../../model/index.js";

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

/** Papers a search lets through. A search also matches the folder path shown in the row. */
export function papersInScope(papers: ListPaper[], query: Query): ListPaper[] {
  if (isEmptyQuery(query)) return papers;
  return papers.filter((p) => paperMatches(p, searchDoc(p, { folder: p.relFolder }), query));
}
