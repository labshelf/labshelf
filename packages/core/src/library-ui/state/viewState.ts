/**
 * The library UI's state: the library from the last snapshot, the open folder, the list controls and the selection.
 */
import { PAPERS_DIR, type FolderTreeNode } from "../../library/index.js";
import type { PaperRecord, PaperStatus } from "../../model/index.js";

export type StatusFilter = "all" | PaperStatus;
export type SortKey = "title" | "creator" | "year" | "publication" | "status";
export type SortDir = 1 | -1;

export interface LibraryViewState {
  folders: FolderTreeNode[];
  /** Every paper in the library; the views derive the folder scope. */
  papers: PaperRecord[];
  /** "papers/foo/bar"-style path; "papers" is the library root. */
  folder: string;
  query: string;
  status: StatusFilter;
  sortKey: SortKey;
  sortDir: SortDir;
  includeSub: boolean;
  /** Replaced on every change so slice equality stays a reference check. */
  selected: ReadonlySet<string>;
  anchor: string | null;
  cursor: string | null;
  /** True until the host sends the first snapshot. */
  loading: boolean;
  /** Record paths whose folder holds the paper's PDF. */
  pdfDirs: ReadonlySet<string>;
  /** Paper ids with a PDF search in flight. */
  pdfBusy: ReadonlySet<string>;
}

export const INITIAL_VIEW_STATE: LibraryViewState = {
  folders: [],
  papers: [],
  folder: PAPERS_DIR,
  query: "",
  status: "all",
  sortKey: "title",
  sortDir: 1,
  includeSub: true,
  selected: new Set(),
  anchor: null,
  cursor: null,
  loading: true,
  pdfDirs: new Set(),
  pdfBusy: new Set(),
};
