/**
 * Declares the runtime messages between the background and the extension pages and content script, in one typed envelope.
 */
import type { IfNoPdf, PdfAccess, PdfMiss } from "@labshelf/core";

export type RuntimeMessage =
  | { type: "auth.status" }
  | { type: "auth.connect" }
  | { type: "auth.disconnect" }
  | { type: "sync.now" }
  | { type: "sync.status" }
  | { type: "sync.scheduleSoon"; reason: string }
  /** Reads the paper shown in a tab (the popup's first call). */
  | { type: "capture.inspect"; tabId: number }
  /** Waits for the PDF search the inspect started; the popup shows the result. */
  | { type: "capture.findPdf"; tabId: number }
  /** Saves the inspected paper into `folder` with the user's tags and note. */
  | { type: "capture.save"; tabId: number; folder?: string; tags?: string[]; note?: string; ifNoPdf?: IfNoPdf; retryPdf?: boolean }
  /** Inspects and saves a tab in one go (the library page's "Add from open tab"). */
  | { type: "capture.tab"; tabId: number; targetFolder?: string; ifNoPdf?: IfNoPdf; retryPdf?: boolean }
  /** Saves one Google Scholar result. */
  | { type: "scholar.save"; hit: ScholarHit; folder?: string; ifNoPdf?: IfNoPdf; retryPdf?: boolean }
  /** Popup, paper already in the library without a PDF: attach the PDF found for this tab to that copy. */
  | { type: "capture.attachPdf"; tabId: number }
  /** Library page "Find PDF": run the resolver chain for a saved paper and attach what it finds. */
  /** `replace` looks only for a better version than the paper's preprint or accepted PDF, and replaces it. */
  | { type: "paper.findPdf"; id: string; replace?: boolean }
  /** Library page: opens the page that stood in the way of a saved paper's PDF and attaches the PDF once the user gets through. */
  | { type: "paper.openForPdf"; id: string; access: PdfAccess }
  /** Library page "Ask the author": drafts the request email for a saved paper without a PDF. */
  | { type: "paper.askAuthor"; id: string }
  /** Removes a paper just saved (the popup's undo). */
  | { type: "paper.remove"; id: string }
  /** Collections a paper can be saved into, plus the last one used. */
  | { type: "library.folders" }
  /** Which of these papers the library already holds, by key. */
  | { type: "library.lookup"; items: LookupItem[] }
  /** Opens the library page on a collection, optionally selecting a paper. */
  | { type: "library.open"; folder?: string; paperId?: string }
  /** Lists the current window's http(s) tabs, excluding extension pages. */
  | { type: "tabs.list" }
  /** Library page: builds the citation map from OpenAlex for the library's papers. */
  | { type: "citationMap.build" }
  /** Library page: saves the paper with this DOI through the capture flow, or reports it already there. */
  | { type: "citationMap.importDoi"; doi: string }
  /** Popup: the offer to attach a PDF this tab showed, or the latest download, to a paper without one; null when none. */
  | { type: "pdfOffer.get"; tabId: number }
  | { type: "pdfOffer.attach"; offerId: string }
  | { type: "pdfOffer.dismiss"; offerId: string };

export type RuntimeResponse =
  | { ok: true; data?: unknown }
  | { ok: false; error: string };

/** Reply to citationMap.importDoi. */
export interface ImportedDoiData {
  status: "saved" | "already-present";
  id: string;
  title: string;
}

/** The library's copy of a paper. */
export interface LibraryRef {
  id: string;
  path: string;
  /** Collection holding it. */
  folder: string;
  /** `<path>/paper.pdf` exists in the IndexedDB files store. Required, so the compiler finds every producer. */
  hasPdf: boolean;
}

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

/** Reply to capture.save, capture.tab and scholar.save. */
export type SaveOutcome = SavedPaperData | NoPdfData;

/** Reply to capture.attachPdf and paper.findPdf. */
export interface AttachPdfData {
  id: string;
  /** paper.pdf was written now. */
  attached: boolean;
  /** The PDF written replaced a preprint or accepted manuscript. */
  replaced?: boolean;
  source?: string;
  /** Nothing written because a PDF was already there (e.g. it arrived by sync meanwhile). */
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

/**
 * Background (or the reader, for "annotations") -> extension pages after the library changed. Kept OUT of
 * RuntimeMessage, because background/index forces every RuntimeMessage to be
 * handled and this broadcast is not a request.
 */
export interface LibraryChangedBroadcast {
  type: "library.changed";
  reason: "capture" | "attach" | "remove" | "sync" | "annotations" | "askAuthor";
  paperId?: string;
  /** A sentence for open library pages to show, for a change the user did not start there (a watched tab's PDF). */
  notice?: string;
}

export interface FolderOption {
  path: string;
  /** 0 for the root, 1 for its children, … */
  depth: number;
}

export interface FoldersData {
  folders: FolderOption[];
  lastFolder: string;
}

export interface LookupItem {
  key: string;
  doi?: string;
  arxivId?: string;
  title?: string;
  year?: number;
}

export type LookupData = Record<string, LibraryRef>;

/** One Google Scholar result, as the content script reads it. */
export interface ScholarHit {
  /** Scholar's cluster id (data-cid). */
  key: string;
  title: string;
  /** The title link — the article's landing page. */
  url?: string;
  /** The "[PDF]" link in the right column. */
  pdfUrl?: string;
  /** As printed: abbreviated, possibly truncated. */
  authors: string[];
  venue?: string;
  year?: number;
}

export interface TabSummary {
  id: number;
  title: string;
  url: string;
}
