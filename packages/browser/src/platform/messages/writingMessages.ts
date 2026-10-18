// Declares the runtime messages of the writing companion (editor insertion, bibliography health, citing, site marks, reviews), with their replies.
import type { LibraryRef, LookupItem } from "./libraryMessages";

// Outside RuntimeMessage until the router handles them: its switch must cover every RuntimeMessage.
export type WritingMessage =
  /** Inserts text at the cursor of the active Overleaf or typst.app editor; `fallback: "copy"` copies it when insertion fails. */
  | { type: "editor.insert"; text: string; fallback: "copy" | "none" }
  /** Checks the bibliography of the project open in this tab against the library. */
  | { type: "bib.health"; tabId: number }
  /** Cites a paper in a browser project, optionally at a page and with a quote. */
  | { type: "cite.inProject"; paperId: string; projectId?: string; page?: number; quote?: string }
  /** Which of these results the library holds and which browser projects cite them, by key. */
  | { type: "sites.lookup"; items: LookupItem[] }
  /** Saves an OpenReview submission into `Reviews/<venue>/` and opens it with a review draft. */
  | { type: "review.start"; url: string; title: string; venue: string; pdfUrl?: string };

/** Reply to editor.insert. */
export type InsertOutcome = "inserted" | "copied" | "no-editor";

/** Reply to bib.health. */
export interface BibHealthData {
  /** Cited keys the library holds, with the paper each resolves to. */
  inLibrary: { key: string; paperId: string }[];
  /** Cited keys the library does not hold. */
  missing: string[];
  /** Cited papers whose metadata fails the bibliography lint. */
  poorMetadata: { paperId: string; title: string; issues: string[] }[];
}

/** Reply to cite.inProject: typed into the open editor, or written into the project's main file. */
export type CiteOutcome = "inserted" | "file";

/** One entry of the reply to sites.lookup. */
export interface SiteMark {
  library?: LibraryRef;
  /** Names of the browser projects that cite the paper. */
  citedIn: string[];
}

export type SitesLookupData = Record<string, SiteMark>;

/** Reply to review.start. */
export interface ReviewStartData {
  paperId: string;
  /** Library path of the review draft beside the PDF. */
  reviewPath: string;
}
