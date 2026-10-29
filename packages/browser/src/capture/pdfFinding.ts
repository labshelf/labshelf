// Captures a paper in two steps, inspect then save, so the popup shows the paper before anything is written.
// The PDF search starts once a draft exists, so Save is usually instant. Also reads page 1 of a PDF as text.
import type * as Pdfjs from "pdfjs-dist";
import {
  PAPERS_DIR, derivePageFacts, deriveResolvedMetadata, extractPaperIdentifiers, findInLibrary, findPaperPdf, isLibraryPath,
  normalizeTags, resolvePagePaper, withAbstract,
} from "@labshelf/core";
import type {
  DetectedIds, ILogger, MetadataOrigin, MetadataSource, MissingPdfAction, PageFacts, PaperRecord, PdfAttempt, PdfCandidate, PdfFetchOptions,
  PaperNotesStore, PdfMiss, PdfVersion, RawPage, ResolvedMetadata, ResolvedPdf,
} from "@labshelf/core";
import { extractIdentifiersFromHit } from "../content";
import { bx, readSettings, updateSettings, type SearchHit } from "../platform";
import { listCachedPaperRecords, type LibraryMutations } from "../storage";
import type { FirstPageTextReply, FirstPageTextRequest } from "./attach";
import { fetchLandingFacts, readTabPage } from "./pageProbe";
import { fetchInTab, fetchViaHelperTab } from "./tabFetch";

const MODULE = "capture";

/** Everything known about one paper before it is saved. */
export interface CaptureDraft {
  /** Where the draft came from: the tab URL or the Scholar result's link. */
  pageUrl: string;
  ids: DetectedIds;
  metadata: ResolvedMetadata;
  origin: MetadataOrigin;
  isPaper: boolean;
  pdfCandidates: PdfCandidate[];
  /** The tab whose session may be borrowed for same-site downloads; absent for papers captured without a tab. */
  fetchOpts: Pick<PdfFetchOptions, "tab">;
  /** The library's copy, when the paper is already there. */
  existing?: PaperRecord;
  /** Started on first request; shared by the popup's PDF check and Save. */
  pdf?: Promise<ResolvedPdf | undefined>;
  pdfAttempts: PdfAttempt[];
  /** Set to look only for a copy that outranks the paper's PDF of this version. */
  betterThan?: PdfVersion;
  /** The probed tab's page, kept for the author addresses it shows; absent for papers captured without a tab. */
  page?: RawPage;
}

export interface SaveOptions {
  folder?: string;
  tags?: string[];
  /** Becomes the first item of the paper's notes.qmd; blank writes nothing. */
  note?: string;
  /** Where the note is written; only `addItem` is used. */
  notes?: Pick<PaperNotesStore, "addItem">;
}

export interface SavedPaper {
  paper: PaperRecord;
  /** Collection the paper was saved into. */
  folder: string;
  /** Resolver that supplied the PDF, or null when none could be downloaded. */
  pdfSource: string | null;
}

/**
 * Probes a tab and settles what paper it shows.
 */
export async function detectTabDraft(log: ILogger, tabId: number, tabUrl: string): Promise<CaptureDraft> {
  const raw = await readTabPage(log, tabId, tabUrl);
  const facts = derivePageFacts(raw);
  return { ...(await createDraftFromFacts(log, facts, { tab: { url: tabUrl, fetchInTab: (url) => fetchInTab(tabId, url) } })), page: raw };
}

/**
 * Builds a draft from interpreted page facts plus any extra metadata sources
 * (a Scholar result's own line), resolving the record and checking the library.
 */
async function createDraftFromFacts(
  log: ILogger,
  facts: PageFacts,
  fetchOpts: CaptureDraft["fetchOpts"],
  extraSources: MetadataSource[] = [],
): Promise<CaptureDraft> {
  const { isPaper, existing, ...resolved } = await resolvePagePaper(facts, listCachedPaperRecords, { extraSources, deps: { registry: { logger: log } } });

  void log.log("INFO", MODULE, "capture inspected", {
    page: facts.pageUrl,
    isPaper,
    origin: resolved.origin,
    doi: resolved.ids.doi ?? null,
    arxiv: resolved.ids.arxivId ?? null,
    pdfLinks: facts.pdfCandidates.length,
    existing: existing?.id ?? null,
  });

  return {
    pageUrl: facts.pageUrl,
    ids: resolved.ids,
    metadata: resolved.metadata,
    origin: resolved.origin,
    isPaper,
    pdfCandidates: facts.pdfCandidates,
    fetchOpts,
    pdfAttempts: [],
    ...(existing ? { existing } : {}),
  };
}

/**
 * Starts (once) and returns the PDF search for a draft.
 */
export function findPdf(log: ILogger, draft: CaptureDraft): Promise<ResolvedPdf | undefined> {
  draft.pdf ??= (async () => {
    const settings = await readSettings();
    return findPaperPdf(
      { ...draft.fetchOpts, credentials: "include", logger: log, proxies: settings.proxies, viaHelperTab: (urls, signal) => fetchViaHelperTab(log, urls, signal) },
      {
        ids: draft.ids,
        metadata: draft.metadata,
        landingUrl: draft.pageUrl || undefined,
        pageCandidates: draft.pdfCandidates,
        input: draft.pageUrl,
        contactEmail: settings.contactEmail,
        customResolvers: settings.customResolvers,
        betterThan: draft.betterThan,
      },
      draft.pdfAttempts,
    );
  })().catch((err: unknown) => {
    void log.error(MODULE, err, { op: "findPdf", page: draft.pageUrl });
    return undefined;
  });
  return draft.pdf;
}

/**
 * Saves a draft into the library. Refuses a page that is not a paper and has
 * no PDF either — there would be nothing worth keeping.
 */
async function saveDraft(log: ILogger, mutations: LibraryMutations, draft: CaptureDraft, opts: SaveOptions = {}): Promise<SavedPaper> {
  const [pdf, metadata] = await Promise.all([findPdf(log, draft), withAbstract(draft.metadata, { registry: { logger: log } })]);
  if (!pdf && !draft.isPaper) {
    throw new Error("No paper found on this page — open the article's page, its PDF, or a Google Scholar result.");
  }
  const settings = await readSettings();
  const folder = normalizeFolder(opts.folder ?? settings.lastFolder);
  const tags = normalizeTags(opts.tags ?? []);
  const note = opts.note?.trim();
  const paper = await mutations.importPaper(folder, {
    metadata: { ...metadata, title: metadata.title ?? "Untitled" },
    pdf: pdf?.bytes,
    pdfVersion: pdf?.version,
    extra: { ...(tags.length ? { tags } : {}) },
    log: { message: "Paper captured", context: { page: draft.pageUrl, pdfSource: pdf?.source ?? null, origin: draft.origin } },
  });
  if (note && opts.notes) {
    try {
      await opts.notes.addItem(paper.id, { body: note });
    } catch (err) {
      void log.error(MODULE, err, { op: "addNote", paper: paper.id });
    }
  }
  if (folder !== settings.lastFolder) await updateSettings({ lastFolder: folder });
  draft.existing = paper;
  return { paper, folder, pdfSource: pdf?.source ?? null };
}

/**
 * Pure summary of what a failed search tried, for the "No PDF found" dialog. Its access page is the library proxy's
 * sign-in page when a proxy redirected to one, because signing in there grants access to every publisher; otherwise
 * the best-ranked candidate that answered a sign-in or a bot check, as attempts arrive in rank order.
 */
export function derivePdfMiss(attempts: PdfAttempt[]): PdfMiss {
  const wall = attempts.find((a) => a.outcome === "login" && a.proxy !== undefined)
    ?? attempts.find((a) => a.outcome === "login" || a.outcome === "bot");
  return {
    ...(wall ? { access: { kind: wall.outcome === "login" ? "login" : "bot", url: wall.url } } : {}),
    tried: new Set(attempts.map((a) => a.url)).size,
    sources: [...new Set(attempts.map((a) => a.source))],
    blocked: attempts.some((a) => a.outcome === "bot"),
    needsLogin: attempts.some((a) => a.outcome === "login"),
  };
}

/** Forgets a finished search so the next findPdf runs the chain again ("Search again"). */
export function refreshPdfSearch(draft: CaptureDraft): void {
  delete draft.pdf;
  draft.pdfAttempts = [];
}

/** The outcome of a consent-gated save: a written paper, or a PDF miss with nothing written. */
export type WriteDecision = { kind: "saved"; saved: SavedPaper } | { kind: "no-pdf"; miss: PdfMiss };

/**
 * saveDraft behind the user's consent: with "ask", a paper whose PDF cannot be
 * reached is NOT written — the caller shows the "No PDF found" dialog and
 * re-sends with "save" to confirm. findPdf is memoised, so the confirming call
 * reuses the finished search rather than running it again.
 */
export async function writeOrAsk(
  log: ILogger,
  mutations: LibraryMutations,
  draft: CaptureDraft,
  opts: SaveOptions = {},
  ifNoPdf: MissingPdfAction = "ask",
): Promise<WriteDecision> {
  if (ifNoPdf === "ask" && draft.isPaper && !(await findPdf(log, draft))) {
    void log.log("INFO", MODULE, "no pdf: asking before saving", { page: draft.pageUrl, tried: draft.pdfAttempts.length });
    return { kind: "no-pdf", miss: derivePdfMiss(draft.pdfAttempts) };
  }
  if (ifNoPdf !== "ask" && draft.isPaper && !(await findPdf(log, draft))) {
    void log.log("INFO", MODULE, "saved without pdf (confirmed)", { page: draft.pageUrl, tried: draft.pdfAttempts.length, ifNoPdf });
  }
  return { kind: "saved", saved: await saveDraft(log, mutations, draft, opts) };
}

/**
 * Re-checks the library for the draft's paper: it may have been saved or
 * removed elsewhere since the draft was cached (guards against a duplicate on
 * "Add from open tab" and against a stale "already in library" mark).
 */
export async function refreshExisting(draft: CaptureDraft): Promise<void> {
  const hit = draft.isPaper
    ? findInLibrary(await listCachedPaperRecords(), { ...draft.ids, title: draft.metadata.title, year: draft.metadata.year })
    : undefined;
  if (hit) draft.existing = hit;
  else delete draft.existing;
}

/**
 * Only collections under papers/ are valid targets; anything else falls back
 * to the library root rather than writing outside the library.
 */
export function normalizeFolder(folder: string | undefined): string {
  const clean = folder?.replace(/\/+$/, "");
  return isLibraryPath(clean) ? clean : PAPERS_DIR;
}

// Turns a paper already in the library into a capture draft, so "Find PDF" runs the resolver chain without a tab.
// Identifiers and title, authors and year come from the stored record; the landing page is read once.
/**
 * Builds the PDF-search draft for a saved paper. The record's own identifiers
 * win over whatever the landing page states.
 */
export async function createDraftFromPaper(log: ILogger, r: PaperRecord): Promise<CaptureDraft> {
  const landing = r.url ? await fetchLandingFacts(log, r.url) : undefined;
  return {
    pageUrl: r.url ?? "",
    ids: { ...(landing?.ids ?? {}), ...extractPaperIdentifiers(r) },
    metadata: deriveResolvedMetadata(r),
    origin: "none",
    isPaper: true,
    pdfCandidates: landing?.pdfCandidates ?? [],
    fetchOpts: {},
    pdfAttempts: [],
    existing: r,
  };
}

// Turns one Google Scholar or Google search result into a capture draft: ids in its links, else landing page, else title search.
// A title match must agree with the year and authors the result printed; Scholar's "[PDF]" link is the first candidate.
// The result's own line is abbreviated ("OH Ibarra", "Proceedings of the …"), so
// it only fills what nothing better states.
const HIT_TRUST = 20;

/**
 * What the result itself printed, as a low-trust metadata source.
 */
export function deriveMetadataFromHit(hit: SearchHit): ResolvedMetadata {
  const meta: ResolvedMetadata = { title: hit.title };
  if (hit.authors.length) meta.authors = hit.authors;
  if (hit.year) meta.year = hit.year;
  if (hit.venue && !hit.venue.includes("…")) meta.journal = hit.venue;
  if (hit.url) meta.url = hit.url;
  return meta;
}

/**
 * Builds the draft for a search result.
 */
export async function createDraftFromSearchHit(log: ILogger, hit: SearchHit): Promise<CaptureDraft> {
  const ids = extractIdentifiersFromHit(hit);
  const landing = !ids.doi && !ids.arxivId && hit.url ? await fetchLandingFacts(log, hit.url) : undefined;

  const scholarPdf: PdfCandidate[] = hit.pdfUrl ? [{ url: hit.pdfUrl, source: "scholar" }] : [];
  const facts: PageFacts = landing
    ? { ...landing, ids: { ...ids, ...landing.ids }, isPaper: true, pdfCandidates: [...scholarPdf, ...landing.pdfCandidates] }
    : { pageUrl: hit.url ?? hit.pdfUrl ?? "", ids, metadata: {}, structured: false, pdfCandidates: scholarPdf, isPaper: true };

  const hitSource: MetadataSource = { name: "search result", trust: HIT_TRUST, metadata: deriveMetadataFromHit(hit) };
  return createDraftFromFacts(log, facts, {}, [hitSource]);
}

// Reads the first page of a PDF as text, one line per line of the page, with the vendored pdf.js.
export type PdfjsLib = typeof Pdfjs;

let pdfjs: Promise<PdfjsLib> | undefined;

// Needs a document with workers: the Firefox event page or the Chrome offscreen document, never a service worker.
export function loadPdfjs(): Promise<PdfjsLib> {
  pdfjs ??= (async () => {
    const lib = (await import(bx.runtime.getURL("vendor/pdfjs/build/pdf.min.mjs"))) as PdfjsLib;
    // PLATFORM: MV3 pages may not start blob: workers (Firefox refuses them); the extension's own module URL works.
    lib.GlobalWorkerOptions.workerPort = new Worker(bx.runtime.getURL("vendor/pdfjs/build/pdf.worker.min.mjs"), { type: "module" });
    return lib;
  })();
  return pdfjs;
}

/** @returns the text of page 1 with a newline wherever pdf.js ends a line */
export async function extractFirstPageText(bytes: Uint8Array): Promise<string> {
  const lib = await loadPdfjs();
  // pdf.js transfers the buffer to its worker; a private copy keeps the caller's bytes readable.
  const task = lib.getDocument({ data: new Uint8Array(bytes) });
  try {
    const page = await (await task.promise).getPage(1);
    const content = await page.getTextContent();
    let text = "";
    for (const item of content.items) {
      if (!("str" in item)) continue;
      text += item.hasEOL ? `${item.str}\n` : item.str;
    }
    return text;
  } finally {
    await task.destroy();
  }
}

// Gets page-1 text of a staged PDF from the background: through an offscreen document in Chrome, in place in Firefox.
const OFFSCREEN_URL = "import/offscreen.html";

interface OffscreenApi {
  createDocument(params: { url: string; reasons: string[]; justification: string }): Promise<void>;
  closeDocument(): Promise<void>;
  hasDocument?(): Promise<boolean>;
}

// PLATFORM: Chrome's service worker has no DOM and cannot start pdf.js's worker; Firefox's event page can.
function offscreenApi(): OffscreenApi | undefined {
  return (globalThis as { chrome?: { offscreen?: OffscreenApi } }).chrome?.offscreen;
}

// INVARIANT: one offscreen document at a time; extractions queue so one never closes the document under another.
let queue: Promise<unknown> = Promise.resolve();

async function viaOffscreen(api: OffscreenApi, id: string): Promise<string> {
  if (!(await api.hasDocument?.())) {
    await api.createDocument({ url: OFFSCREEN_URL, reasons: ["WORKERS"], justification: "Read the title on page 1 of a PDF the user downloaded or opened." });
  }
  try {
    const request: FirstPageTextRequest = { type: "offscreen.firstPageText", id };
    const reply = (await bx.runtime.sendMessage(request)) as FirstPageTextReply | undefined;
    if (!reply) throw new Error("The offscreen document did not answer.");
    if (!reply.ok) throw new Error(reply.error);
    return reply.text;
  } finally {
    await api.closeDocument();
  }
}

/** @param id the key the bytes are staged under, for the offscreen document to read them by */
export function readFirstPageText(id: string, bytes: Uint8Array): Promise<string> {
  const api = offscreenApi();
  if (!api) return extractFirstPageText(bytes);
  const run = queue.then(() => viaOffscreen(api, id));
  queue = run.catch(() => undefined);
  return run;
}
