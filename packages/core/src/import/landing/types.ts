/** Declares the shapes a landing page passes through: raw evidence from the page, then the facts read from it. */
import type { DetectedIds } from "../identifiers/index.js";
import type { ResolvedMetadata } from "../metadata/index.js";

/** A link or viewer on the page that may lead to the article PDF. */
export interface RawPdfLink {
  url: string;
  /**
   * embed — a PDF viewer embedded in the page (<embed>/<iframe>/<object>);
   * alternate — <link rel="alternate" type="application/pdf">;
   * labelled — an anchor whose text, title or attributes say "PDF";
   * href — an anchor whose URL looks like a PDF.
   */
  kind: "embed" | "alternate" | "labelled" | "href";
}

/** Everything a page showed, as plain JSON (it crosses the browser's scripting boundary). */
export interface RawPage {
  pageUrl: string;
  /** document.title, or the PDF viewer's title when the tab is a PDF. */
  documentTitle?: string;
  /** True when the tab is showing a PDF document itself. */
  pageIsPdf?: boolean;
  /** Lower-cased <meta name|property> → every content value, in page order. */
  meta: Record<string, string[]>;
  pdfLinks: RawPdfLink[];
  /** hrefs of doi.org links — publishers print the article's own DOI this way. */
  doiLinks: string[];
}

/** A URL that may serve the paper's PDF, and who suggested it (shown to the user). */
export interface PdfCandidate {
  url: string;
  source: string;
}

export interface PageFacts {
  pageUrl: string;
  ids: DetectedIds;
  /** Fields the page itself states; empty when it states none. */
  metadata: ResolvedMetadata;
  /** True when the metadata came from structured citation tags, not just the page title. */
  structured: boolean;
  /** PDF links found on the page, most trustworthy first. */
  pdfCandidates: PdfCandidate[];
  /** The page is a scholarly work: it names an identifier, states citation tags, or is a PDF. */
  isPaper: boolean;
}
