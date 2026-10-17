/**
 * Declares the library UI's state: the library from the last snapshot, what the host sent about single papers,
 * the open folder, the list controls, the selection and the citation map view.
 */
import { PAPERS_DIR, type FolderTreeNode } from "../../library/index.js";
import type { PaperRecord } from "../../model/index.js";
import type { CitationMapState, PaperDetails, PaperFilesState, PaperStats, SimilarPaper, TextLayerJobView } from "../protocol/index.js";
import { DEFAULT_COLUMNS, type ColumnKey } from "./columns.js";

export type SortKey = "title" | "creator" | "venue" | "year" | "lastRead" | "status";
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
  sortKey: SortKey;
  sortDir: SortDir;
  /** The optional columns the list shows, in display order. */
  columns: readonly ColumnKey[];
  /** Replaced on every change so slice equality stays a reference check. */
  selected: ReadonlySet<string>;
  anchor: string | null;
  cursor: string | null;
  /** The paper whose files are shown; null when none is open. */
  open: string | null;
  /** File listings by paper id, as the host last sent them; loading until the reply arrives. */
  files: Readonly<Record<string, PaperFilesState | { status: "loading" }>>;
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
  /** The citation map shown in place of the paper list; null while the paper list shows. */
  citationMap: CitationMapState | null;
  /** Work ids of the missing works being imported from the citation map. */
  citationImporting: ReadonlySet<string>;
}

export const INITIAL_VIEW_STATE: LibraryViewState = {
  folders: [],
  papers: [],
  stats: {},
  folder: PAPERS_DIR,
  query: "",
  sortKey: "title",
  sortDir: 1,
  columns: DEFAULT_COLUMNS,
  selected: new Set(),
  anchor: null,
  cursor: null,
  open: null,
  files: {},
  loading: true,
  pdfDirs: new Set(),
  pdfBusy: new Set(),
  jobs: {},
  details: {},
  similar: {},
  citationMap: null,
  citationImporting: new Set(),
};
