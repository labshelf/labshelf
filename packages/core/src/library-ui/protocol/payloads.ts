/**
 * The data shapes the library UI protocol carries: the library snapshot, the per-paper reading stats and details,
 * text-layer jobs, similar papers, and the PDF and add-paper replies. All plain JSON.
 */
import type { FolderTreeNode } from "../../library/index.js";
import type { Annotation, PaperRecord } from "../../model/index.js";

/** What the reader's sidecar says about a paper, for the row marks and the Last read column. */
export interface PaperStats {
  annotations: number;
  lastPage?: number;
  /** ISO timestamp of the last reading position. */
  lastRead?: string;
}

/**
 * The library as the UI renders it. Paths are "/"-separated and start at "papers". `pdfDirs` lists the record paths
 * whose folder holds the paper's PDF; `stats` is keyed by paper id and may leave papers out.
 */
export interface LibraryUiSnapshot {
  folders: FolderTreeNode[];
  papers: PaperRecord[];
  pdfDirs: string[];
  stats: Record<string, PaperStats>;
}

/** The heavy per-paper data the detail pane asks for when a paper is shown. */
export interface PaperDetails {
  annotations: Annotation[];
  reading: { page: number; updatedAt: string } | null;
  /** The PDF on this device: its size and its path below the library root; null when it is not here. */
  pdf: { size: number; relPath: string } | null;
}

/** A paper waiting for, or in the middle of, OCR. */
export interface TextLayerJobView {
  paperId: string;
  phase: "queued" | "reading";
  /** While reading: the 1-based page among `total` pages to read. */
  page?: number;
  total?: number;
}

/** A paper whose content resembles another's; `score` runs from 0 to 1. */
export interface SimilarPaper {
  paperId: string;
  score: number;
}

/** What a PDF search tried before it gave up. */
export interface PdfMiss {
  /** Candidate URLs downloaded and rejected. */
  tried: number;
  /** Resolver ids consulted, in chain order. */
  sources: string[];
  /** At least one candidate answered with a bot check. */
  blocked: boolean;
}

/** Something the host can add a paper from, such as an open browser tab. */
export interface AddSource {
  id: string;
  label: string;
  description: string;
}

/** Whether a capture without a PDF asks first or saves the reference anyway. */
export type IfNoPdf = "ask" | "save";
