/**
 * The library UI's state: the library from the last snapshot, what the host sent about single papers, the open
 * folder, the list controls and the selection.
 */
import { PAPERS_DIR, type FolderTreeNode } from "../../library/index.js";
import type { PaperRecord, PaperStatus } from "../../model/index.js";
import type { PaperDetails, PaperStats, SimilarPaper, TextLayerJobView } from "../protocol/index.js";

export type StatusFilter = "all" | PaperStatus;
export type SortKey = "title" | "creator" | "year" | "publication" | "lastRead" | "status";
export type SortDir = 1 | -1;

export interface LibraryViewState {
  folders: FolderTreeNode[];
  /** Every paper in the library; the views derive the folder scope. */
  papers: PaperRecord[];
  /** Reading stats by paper id. */
  stats: Readonly<Record<string, PaperStats>>;
  /** "papers/foo/bar"-style path; "papers" is the library root. */
  folder: string;
  query: string;
  status: StatusFilter;
  /** Only papers whose PDF has no text layer. */
  noText: boolean;
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
  /** OCR jobs by paper id. */
  jobs: Readonly<Record<string, TextLayerJobView>>;
  /** Per-paper data the detail pane asked for, by paper id. */
  details: Readonly<Record<string, PaperDetails>>;
  /** Similar papers by paper id; null while the host searches. */
  similar: Readonly<Record<string, SimilarPaper[] | null>>;
}

export const INITIAL_VIEW_STATE: LibraryViewState = {
  folders: [],
  papers: [],
  stats: {},
  folder: PAPERS_DIR,
  query: "",
  status: "all",
  noText: false,
  sortKey: "title",
  sortDir: 1,
  includeSub: true,
  selected: new Set(),
  anchor: null,
  cursor: null,
  loading: true,
  pdfDirs: new Set(),
  pdfBusy: new Set(),
  jobs: {},
  details: {},
  similar: {},
};
