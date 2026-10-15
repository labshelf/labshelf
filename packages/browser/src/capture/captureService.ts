// Captures a paper in two steps, inspect then save, so the popup shows the paper before anything is written.
// The PDF search starts once a draft exists, so Save is usually instant.
import { PAGE_TRUST, findInLibrary, interpretPage, makeResolveContext, resolvePdf, resolveMetadata, withAbstract } from "@labshelf/core";
import type {
  DetectedIds, MetadataOrigin, MetadataSource, PageFacts, PaperRecord, PdfAttempt, PdfCandidate, PdfFetchOptions,
  ResolvedMetadata, ResolvedPdf,
} from "@labshelf/core";
import { fetchInTab, fetchViaHelperTab } from "./tab";
import { probeTab } from "./tabProbe";
import { addPaper } from "./addPaperFlow";
import { getSettings, updateSettings } from "../platform";
import { BrowserLogger } from "../platform";
import { listAllRecords } from "../storage";
import type { IfNoPdf, PdfMiss } from "@labshelf/core";
import { PAPERS_DIR, isLibraryPath } from "@labshelf/core";

const log = new BrowserLogger("capture");

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
export async function inspectTab(tabId: number, tabUrl: string): Promise<CaptureDraft> {
  const raw = await probeTab(tabId, tabUrl);
  const facts = interpretPage(raw);
  return draftFromFacts(facts, { tab: { url: tabUrl, fetchInTab: (url) => fetchInTab(tabId, url) } });
}

/**
 * Builds a draft from interpreted page facts plus any extra metadata sources
 * (a Scholar result's own line), resolving the record and checking the library.
 */
export async function draftFromFacts(
  facts: PageFacts,
  fetchOpts: CaptureDraft["fetchOpts"],
  extraSources: MetadataSource[] = [],
): Promise<CaptureDraft> {
  const pageSource: MetadataSource = {
    name: "page",
    trust: facts.structured ? PAGE_TRUST.structured : PAGE_TRUST.titleOnly,
    metadata: facts.metadata,
  };
  const resolved = facts.isPaper || extraSources.length
    ? await resolveMetadata({ ids: facts.ids, sources: [pageSource, ...extraSources] })
    : { metadata: facts.metadata, ids: facts.ids, origin: "none" as const };
  const isPaper = facts.isPaper || resolved.origin === "registry" || resolved.origin === "search";
  const existing = isPaper
    ? findInLibrary(await listAllRecords(), { ...resolved.ids, title: resolved.metadata.title, year: resolved.metadata.year })
    : undefined;

  void log.info("capture inspected", {
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
export function findPdf(draft: CaptureDraft): Promise<ResolvedPdf | undefined> {
  draft.pdf ??= (async () => {
    const settings = await getSettings();
    const context = makeResolveContext(draft.ids, draft.metadata, draft.pageUrl || undefined, draft.pdfCandidates, {
      contactEmail: settings.contactEmail,
      ...(settings.enableSciHub ? { sciHubMirror: settings.sciHubMirror } : {}),
    });
    const pdf = await resolvePdf(
      context,
      { ...draft.fetchOpts, credentials: "include", logger: log, viaHelperTab: fetchViaHelperTab },
      draft.pdfAttempts,
    );
    if (pdf) {
      void log.info("pdf found", { page: draft.pageUrl, source: pdf.source, url: pdf.url, bytes: pdf.bytes.length });
    } else {
      void log.warn("no pdf reachable", { page: draft.pageUrl, tried: draft.pdfAttempts.map((a) => `${a.source} ${a.url}`) });
    }
    return pdf;
  })().catch((err: unknown) => {
    void log.error("capture", err, { op: "findPdf", page: draft.pageUrl });
    return undefined;
  });
  return draft.pdf;
}

/**
 * Saves a draft into the library. Refuses a page that is not a paper and has
 * no PDF either — there would be nothing worth keeping.
 */
async function saveDraft(draft: CaptureDraft, opts: SaveOptions = {}): Promise<SavedPaper> {
  const [pdf, metadata] = await Promise.all([findPdf(draft), withAbstract(draft.metadata)]);
  if (!pdf && !draft.isPaper) {
    throw new Error("No paper found on this page — open the article's page, its PDF, or a Google Scholar result.");
  }
  const settings = await getSettings();
  const folder = safeFolder(opts.folder ?? settings.lastFolder);
  const paper = await addPaper(pdf?.bytes, metadata, metadata.title ?? "Untitled", folder, {
    ...(opts.tags ? { tags: opts.tags } : {}),
    ...(opts.note ? { note: opts.note } : {}),
  });
  if (folder !== settings.lastFolder) await updateSettings({ lastFolder: folder });
  draft.existing = paper;
  if (!pdf) void log.warn("saved without pdf", { id: paper.id, page: draft.pageUrl });
  void log.info("paper captured", { id: paper.id, folder, pdfSource: pdf?.source ?? null, origin: draft.origin });
  return { paper, folder, pdfSource: pdf?.source ?? null };
}

/**
 * Pure summary of what a failed search tried, for the "No PDF found" dialog.
 * Entries labelled "<source> (via tab)" (core resolvePdf) are a bot-check retry,
 * so they are not double-counted but do set `blocked`.
 */
export function summarizeAttempts(attempts: PdfAttempt[]): PdfMiss {
  const direct = attempts.filter((a) => !a.source.endsWith("(via tab)"));
  return {
    tried: new Set(direct.map((a) => a.url)).size,
    sources: [...new Set(direct.map((a) => a.source))],
    blocked: direct.length !== attempts.length,
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
export async function saveOrAsk(draft: CaptureDraft, opts: SaveOptions = {}, ifNoPdf: IfNoPdf = "ask"): Promise<SaveDecision> {
  if (ifNoPdf === "ask" && draft.isPaper && !(await findPdf(draft))) {
    void log.info("no pdf: asking before saving", { page: draft.pageUrl, tried: draft.pdfAttempts.length });
    return { kind: "no-pdf", miss: summarizeAttempts(draft.pdfAttempts) };
  }
  if (ifNoPdf === "save" && draft.isPaper && !(await findPdf(draft))) {
    void log.info("saved without pdf (confirmed)", { page: draft.pageUrl, tried: draft.pdfAttempts.length });
  }
  return { kind: "saved", saved: await saveDraft(draft, opts) };
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
