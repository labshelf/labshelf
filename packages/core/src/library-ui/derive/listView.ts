/**
 * Everything the header, the filter bar and the list derive from one state: the folder's papers, the search scope,
 * the status counts and the sorted rows.
 */
import { parseQuery } from "../../library/search/index.js";
import type { LibraryViewState, StatusFilter } from "../state/index.js";
import { listPapersUnder, papersInScope, statusCounts, type ListPaper } from "./listPapers.js";
import { sortPapers } from "./sortPapers.js";

export interface ListScope {
  /** Every paper under the open folder, nested ones included. */
  inFolder: ListPaper[];
  /** The papers the search and the subfolder toggle leave, before the status tab. */
  scope: ListPaper[];
  counts: Record<StatusFilter, number>;
  /** The search terms to highlight. */
  terms: string[];
}

export interface ListView extends ListScope {
  /** The rows to show, in order. */
  rows: ListPaper[];
}

type ScopeInputs = Pick<LibraryViewState, "papers" | "folder" | "pdfDirs" | "query" | "includeSub">;

export function deriveScope(s: ScopeInputs): ListScope {
  const query = parseQuery(s.query);
  const inFolder = listPapersUnder(s.papers, s.folder, s.pdfDirs);
  const scope = papersInScope(inFolder, query, s.includeSub);
  return { inFolder, scope, counts: statusCounts(scope), terms: query.terms };
}

export function deriveListView(s: ScopeInputs & Pick<LibraryViewState, "status" | "sortKey" | "sortDir">): ListView {
  const scoped = deriveScope(s);
  const filtered = s.status === "all" ? scoped.scope : scoped.scope.filter((p) => p.status === s.status);
  return { ...scoped, rows: sortPapers(filtered, s.sortKey, s.sortDir) };
}
