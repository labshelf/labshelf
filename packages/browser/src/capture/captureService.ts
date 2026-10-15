// Captures a paper in two steps, inspect then save, so the popup shows the paper before anything is written.
// The PDF search starts once a draft exists, so Save is usually instant.
import { findInLibrary, findPaperPdf, interpretPage, normalizeTags, resolvePagePaper, withAbstract } from "@labshelf/core";
import type {
  DetectedIds, MetadataOrigin, MetadataSource, PageFacts, PaperRecord, PdfAttempt, PdfCandidate, PdfFetchOptions,
  ResolvedMetadata, ResolvedPdf,
} from "@labshelf/core";
import { fetchInTab, fetchViaHelperTab } from "./tab";
import { probeTab } from "./tabProbe";
import { getSettings, updateSettings } from "../platform";
import { listAllRecords, type LibraryMutations } from "../storage";
import type { IfNoPdf, ILogger, PdfMiss } from "@labshelf/core";
import { PAPERS_DIR, isLibraryPath } from "@labshelf/core";

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
}

interface SaveOptions {
  folder?: string;
  tags?: string[];
  note?: string;
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
export async function inspectTab(log: ILogger, tabId: number, tabUrl: string): Promise<CaptureDraft> {
  const raw = await probeTab(log, tabId, tabUrl);
  const facts = interpretPage(raw);
  return draftFromFacts(log, facts, { tab: { url: tabUrl, fetchInTab: (url) => fetchInTab(tabId, url) } });
}

/**
 * Builds a draft from interpreted page facts plus any extra metadata sources
 * (a Scholar result's own line), resolving the record and checking the library.
 */
export async function draftFromFacts(
  log: ILogger,
  facts: PageFacts,
  fetchOpts: CaptureDraft["fetchOpts"],
  extraSources: MetadataSource[] = [],
): Promise<CaptureDraft> {
  const { isPaper, existing, ...resolved } = await resolvePagePaper(facts, listAllRecords, { extraSources, deps: { registry: { logger: log } } });

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
    const settings = await getSettings();
    return findPaperPdf(
      { ...draft.fetchOpts, credentials: "include", logger: log, proxies: settings.proxies, viaHelperTab: (urls, signal) => fetchViaHelperTab(log, urls, signal) },
      {
        ids: draft.ids,
        metadata: draft.metadata,
        landingUrl: draft.pageUrl || undefined,
        pageCandidates: draft.pdfCandidates,
        input: draft.pageUrl,
        contactEmail: settings.contactEmail,
        ...(settings.enableSciHub ? { sciHubMirror: settings.sciHubMirror } : {}),
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
  const settings = await getSettings();
  const folder = safeFolder(opts.folder ?? settings.lastFolder);
  const tags = normalizeTags(opts.tags ?? []);
  const note = opts.note?.trim();
  const paper = await mutations.importPaper(folder, {
    metadata: { ...metadata, title: metadata.title ?? "Untitled" },
    pdf: pdf?.bytes,
    extra: { ...(tags.length ? { tags } : {}), ...(note ? { note } : {}) },
    log: { message: "Paper captured", context: { page: draft.pageUrl, pdfSource: pdf?.source ?? null, origin: draft.origin } },
  });
  if (folder !== settings.lastFolder) await updateSettings({ lastFolder: folder });
  draft.existing = paper;
  return { paper, folder, pdfSource: pdf?.source ?? null };
}

/**
 * Pure summary of what a failed search tried, for the "No PDF found" dialog. Its access page is the library proxy's
 * sign-in page when a proxy redirected to one, because signing in there grants access to every publisher; otherwise
 * the best-ranked candidate that answered a sign-in or a bot check, as attempts arrive in rank order.
 */
export function summarizeAttempts(attempts: PdfAttempt[]): PdfMiss {
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
export function resetPdfSearch(draft: CaptureDraft): void {
  delete draft.pdf;
  draft.pdfAttempts = [];
}

/** The outcome of a consent-gated save: a written paper, or a PDF miss with nothing written. */
export type SaveDecision = { kind: "saved"; saved: SavedPaper } | { kind: "no-pdf"; miss: PdfMiss };

/**
 * saveDraft behind the user's consent: with "ask", a paper whose PDF cannot be
 * reached is NOT written — the caller shows the "No PDF found" dialog and
 * re-sends with "save" to confirm. findPdf is memoised, so the confirming call
 * reuses the finished search rather than running it again.
 */
export async function saveOrAsk(
  log: ILogger,
  mutations: LibraryMutations,
  draft: CaptureDraft,
  opts: SaveOptions = {},
  ifNoPdf: IfNoPdf = "ask",
): Promise<SaveDecision> {
  if (ifNoPdf === "ask" && draft.isPaper && !(await findPdf(log, draft))) {
    void log.log("INFO", MODULE, "no pdf: asking before saving", { page: draft.pageUrl, tried: draft.pdfAttempts.length });
    return { kind: "no-pdf", miss: summarizeAttempts(draft.pdfAttempts) };
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
    ? findInLibrary(await listAllRecords(), { ...draft.ids, title: draft.metadata.title, year: draft.metadata.year })
    : undefined;
  if (hit) draft.existing = hit;
  else delete draft.existing;
}

/**
 * Only collections under papers/ are valid targets; anything else falls back
 * to the library root rather than writing outside the library.
 */
export function safeFolder(folder: string | undefined): string {
  const clean = folder?.replace(/\/+$/, "");
  return isLibraryPath(clean) ? clean : PAPERS_DIR;
}
