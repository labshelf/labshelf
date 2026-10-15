/**
 * Derives from one state everything the header, filter bar and list show: the folder's papers, the search scope,
 * the status and No text counts, and the sorted rows.
 */
import { parseQuery } from "../../library/search/index.js";
import type { LibraryViewState, StatusFilter } from "../state/index.js";
import { listPapersUnder, papersInScope, statusCounts, type ListPaper } from "./listPapers.js";
import { sortPapers } from "./sortPapers.js";
import { hasNoText } from "./textLayer.js";

export interface ListScope {
  /** Every paper under the open folder, nested ones included. */
  inFolder: ListPaper[];
  /** The papers the search and the subfolder toggle leave, before the status tab and the No text filter. */
  scope: ListPaper[];
  /** Each status tab's count among the papers the No text filter lets through. */
  counts: Record<StatusFilter, number>;
  /** Papers without a text layer among those the status tab lets through. */
  noTextCount: number;
  /** The papers every filter lets through, unsorted. */
  shown: ListPaper[];
  /** The search terms to highlight. */
  terms: string[];
}

export interface ListView extends ListScope {
  /** The rows to show, in order. */
  rows: ListPaper[];
}

type ScopeInputs = Pick<LibraryViewState, "papers" | "folder" | "pdfDirs" | "query" | "includeSub" | "status" | "noText">;

// Each filter counts what the other one lets through, so a number always says what a click would show.
export function deriveScope(s: ScopeInputs): ListScope {
  const query = parseQuery(s.query);
  const inFolder = listPapersUnder(s.papers, s.folder, s.pdfDirs);
  const scope = papersInScope(inFolder, query, s.includeSub);
  const byStatus = s.status === "all" ? scope : scope.filter((p) => p.status === s.status);
  return {
    inFolder,
    scope,
    counts: statusCounts(s.noText ? scope.filter(hasNoText) : scope),
    noTextCount: byStatus.filter(hasNoText).length,
    shown: s.noText ? byStatus.filter(hasNoText) : byStatus,
    terms: query.terms,
  };
}

export function deriveListView(s: ScopeInputs & Pick<LibraryViewState, "sortKey" | "sortDir" | "stats">): ListView {
  const scoped = deriveScope(s);
  return { ...scoped, rows: sortPapers(scoped.shown, s.sortKey, s.sortDir, s.stats) };
}
