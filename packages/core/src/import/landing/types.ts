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

/** A mailto: link with the page text around it, which tells whether it names the corresponding author. */
export interface RawMailtoLink {
  href: string;
  /** The link's own text. */
  text: string;
  /** Up to about 200 characters of page text before the link, the link text, and about 80 after. */
  context: string;
}

/** A citation_author_email meta value and the citation_author tag that directly preceded it. */
export interface RawAuthorEmail {
  email: string;
  name?: string;
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
  /** At most 20 mailto: links, in page order. */
  mailtoLinks: RawMailtoLink[];
  /** citation_author_email meta tags in page order, kept apart from `meta` because the pairing with authors depends on order. */
  authorEmails: RawAuthorEmail[];
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
