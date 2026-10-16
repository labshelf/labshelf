// Declares the shapes the PDF-finding harness passes between its corpus, runner and report.
import type { PdfAttempt } from "../../src/import/index.js";

export type Scenario = "ids" | "landing";

export interface CorpusEntry {
  /** A DOI, or "arxiv:<id>" for a preprint without one. */
  id: string;
  title: string;
  category: string;
  landingUrl: string;
}

/** How a paper's last attempt ended; "none" when nothing was tried, "timeout" when the paper ran out of time. */
export type MissOutcome = PdfAttempt["outcome"] | "none" | "timeout";

export interface PaperResult {
  id: string;
  title: string;
  category: string;
  found: boolean;
  /** Found and the PDF's first two pages carry the title; a found PDF that fails this is "wrong". */
  correct: boolean;
  /** Share of the title's words on pages 1-2 of the found PDF. */
  titleScore?: number;
  source?: string;
  url?: string;
  missOutcome?: MissOutcome;
  attempts: number;
  ms: number;
}
