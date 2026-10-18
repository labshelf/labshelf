// Declares the runtime messages that capture papers and their PDFs, with their replies.
import type { IfNoPdf, PdfAccess, PdfMiss } from "@labshelf/core";
import type { LibraryRef } from "./libraryMessages";

export type CaptureMessage =
  /** Reads the paper shown in a tab (the popup's first call). */
  | { type: "capture.inspect"; tabId: number }
  /** Waits for the PDF search the inspect started; the popup shows the result. */
  | { type: "capture.findPdf"; tabId: number }
  /** Saves the inspected paper into `folder` with the user's tags and note. */
  | { type: "capture.save"; tabId: number; folder?: string; tags?: string[]; note?: string; ifNoPdf?: IfNoPdf; retryPdf?: boolean }
  /** Inspects and saves a tab in one go (the library page's "Add from open tab"). */
  | { type: "capture.tab"; tabId: number; targetFolder?: string; ifNoPdf?: IfNoPdf; retryPdf?: boolean }
  /** Saves one Google Scholar or Google search result. */
  | { type: "searchHit.save"; hit: SearchHit; folder?: string; ifNoPdf?: IfNoPdf; retryPdf?: boolean }
  /** Popup, paper already in the library without a PDF: attach the PDF found for this tab to that copy. */
  | { type: "capture.attachPdf"; tabId: number }
  /** Library page "Find PDF": run the resolver chain for a saved paper and attach what it finds. */
  /** `replace` looks only for a better version than the paper's preprint or accepted PDF, and replaces it. */
  | { type: "paper.findPdf"; id: string; replace?: boolean }
  /** Library page: opens the page that stood in the way of a saved paper's PDF and attaches the PDF once the user gets through. */
  | { type: "paper.openForPdf"; id: string; access: PdfAccess }
  /** Library page "Ask the author": drafts the request email for a saved paper without a PDF. */
  | { type: "paper.askAuthor"; id: string }
  /** Popup: the offer to attach a PDF this tab showed, or the latest download, to a paper without one; null when none. */
  | { type: "pdfOffer.get"; tabId: number }
  | { type: "pdfOffer.attach"; offerId: string }
  | { type: "pdfOffer.dismiss"; offerId: string };

/** What the popup shows about the tab before saving. */
export interface DraftView {
  isPaper: boolean;
  title: string;
  authors: string[];
  year?: number;
  venue?: string;
  existing?: LibraryRef;
}

export interface PdfStatusData {
  found: boolean;
  /** Who supplied it: page, scholar, publisher, arxiv, crossref, unpaywall, custom. */
  source?: string;
  /** Present when found is false: lets the popup open the dialog instantly, with no round trip. */
  miss?: PdfMiss;
}

export interface SavedPaperData extends LibraryRef {
  status: "saved";
  title: string;
  /** Resolver that supplied the PDF, or null when the paper was saved without one. */
  pdfSource: string | null;
  /** True when nothing was written because the library already had it. */
  alreadyInLibrary?: boolean;
}

/** A save sent with ifNoPdf "ask" found no PDF: NOTHING was written. Re-send with ifNoPdf "save" to confirm. */
interface NoPdfData {
  status: "no-pdf";
  title: string;
  miss: PdfMiss;
}

/** Reply to capture.save, capture.tab and searchHit.save. */
export type SaveOutcome = SavedPaperData | NoPdfData;

/** Reply to capture.attachPdf and paper.findPdf. */
export interface AttachPdfData {
  id: string;
  /** paper.pdf was written now. */
  attached: boolean;
  /** The PDF written replaced a preprint or accepted manuscript. */
  replaced?: boolean;
  source?: string;
  /** Nothing written because a PDF was already there (e.g. it was attached from another tab meanwhile). */
  alreadyHadPdf?: boolean;
  /** Present when nothing was found. */
  miss?: PdfMiss;
}

/**
 * Reply to paper.askAuthor: "mail" opened the request email, "article" opened the article page because no author
 * address was found, "none" means the paper has neither an address nor a page to open.
 */
export interface AskAuthorData {
  id: string;
  opened: "mail" | "article" | "none";
}

/** Reply to pdfOffer.get: a PDF the user opened or downloaded that matched a paper without a PDF. */
export interface PdfOfferView {
  id: string;
  paperId: string;
  title: string;
  /** Collection holding the paper. */
  folder: string;
  /** The PDF could be fetched again; without it the paper can only be opened in the library. */
  hasBytes: boolean;
  source: "tab" | "download";
  /** The offer is badged on the tab the popup asked for. */
  onThisTab: boolean;
}

/** One Google Scholar or Google search result, as the content script reads it. */
export interface SearchHit {
  /** Identity on its page: Scholar's cluster id (data-cid), or the result link on Google. */
  key: string;
  title: string;
  /** The title link — the article's landing page. */
  url?: string;
  /** Scholar's "[PDF]" link in the right column. */
  pdfUrl?: string;
  /** As printed: abbreviated, possibly truncated. */
  authors: string[];
  venue?: string;
  year?: number;
}
