/**
 * Derives from one state everything the header and list show: the folder's papers with its subfolders', the search
 * scope and the sorted rows.
 */
import { parseQuery } from "../../library/search/index.js";
import type { LibraryViewState } from "../store/index.js";
import { listPapersUnder, findPapersInScope, type ListPaper } from "./listPapers.js";
import { orderPapers } from "./orderPapers.js";

export interface ListScope {
  /** Every paper under the open folder, nested ones included. */
  inFolder: ListPaper[];
  /** The papers the search lets through, unsorted. */
  shown: ListPaper[];
  /** The search terms to highlight. */
  terms: string[];
}

export interface ListView extends ListScope {
  /** The rows to show, in order. */
  rows: ListPaper[];
}

type ScopeInputs = Pick<LibraryViewState, "papers" | "folder" | "pdfDirs" | "query">;

export function deriveScope(s: ScopeInputs): ListScope {
  const query = parseQuery(s.query);
  const inFolder = listPapersUnder(s.papers, s.folder, s.pdfDirs);
  const shown = findPapersInScope(inFolder, query);
  return { inFolder, shown, terms: query.terms };
}

export function deriveListView(s: ScopeInputs & Pick<LibraryViewState, "sortKey" | "sortDir" | "stats">): ListView {
  const scoped = deriveScope(s);
  return { ...scoped, rows: orderPapers(scoped.shown, s.sortKey, s.sortDir, s.stats) };
}
