/** The PDF finder's core: its shapes, the two-stage search, the resolver environment and the URL helpers. */
import type { PdfVersion } from "../../model/index.js";
import type { ILogger } from "../../ports/index.js";
import { extractArxivIdentifierFromDoi, type DetectedIds } from "../identifiers/index.js";
import type { PdfCandidate } from "../landing/index.js";
import { DEFAULT_CONTACT_EMAIL, type ResolvedMetadata } from "../registries/index.js";
import { DEFAULT_LIMITS } from "./deadline.js";
import { downloadBest, runBestAccess, startFinds, walkRankedCandidates } from "./engine.js";

// Shapes: what a resolver knows, what it proposes, and the ports a host supplies for downloading.

/** The host's `fetch`. Always invoked as a bare function: browsers throw "Illegal invocation" on `obj.fetch(...)`. */
export type FetchFn = typeof fetch;

export interface FetchedPdf {
  bytes: Uint8Array;
  /** Final URL after redirects and interstitial hops. */
  url: string;
}

/** What a fetch made from inside a browser tab came back with. */
export interface InTabAnswer {
  finalUrl: string;
  pdf?: FetchedPdf;
  /** The HTML answer (an interstitial, a viewer page), for the caller to read for next hops. */
  html?: string;
}

/** A browser tab whose session (cookies, bot clearance) can fetch same-site URLs. */
export interface TabPort {
  url: string;
  fetchInTab(url: string): Promise<InTabAnswer | undefined>;
}

/** A library's proxy as the user pasted it; `template` decides how a URL goes through it (see `proxyKind`). */
export interface LibraryProxy {
  name: string;
  template: string;
  enabled: boolean;
}

/** A page the user knows may hold a paper's PDF: `template` is a URL with `{doi}` where the DOI goes. */
export interface CustomResolver {
  name: string;
  template: string;
  enabled: boolean;
}

export interface PdfFetchOptions {
  fetch?: FetchFn;
  /** "include" sends the user's cookies, so a paper the user can open through an institutional login downloads too. */
  credentials?: "include" | "omit";
  headers?: Record<string, string>;
  logger?: ILogger;
  tab?: TabPort;
  /**
   * Loads URLs of one site, best first, through a real background tab that passes the site's bot check, and returns
   * the first that is a PDF. The run aborts `signal` when it stops waiting for the answer.
   */
  viaHelperTab?: (urls: string[], signal: AbortSignal) => Promise<FetchedPdf | undefined>;
  /** The user's library proxies, in the order to try them; a publisher page that asks for a sign-in is retried through each enabled one. */
  proxies?: readonly LibraryProxy[];
}

/** Everything a resolver may know about the paper; learning resolvers fill in `pmcid` and `arxivId`. */
export interface ResolveContext {
  doi?: string;
  arxivId?: string;
  pmid?: string;
  /** PubMed Central id in canonical "PMC1234567" form. */
  pmcid?: string;
  /** Drives the same-work check on records that aggregators return. */
  title?: string;
  /** Author display names ("Given Family"). */
  authors?: string[];
  year?: number;
  /** The article's landing page; some platforms key the PDF by it, not the DOI. */
  landingUrl?: string;
  /** PDF links the page (or Scholar result) itself offered, best first. */
  pageCandidates: PdfCandidate[];
  /** Contact email for the polite pools of Unpaywall, OpenAlex and CrossRef. */
  contactEmail: string;
  /** The user's custom resolvers; the enabled ones propose addresses built from the DOI. */
  customResolvers?: readonly CustomResolver[];
  /** Versions that lookups' sources gave for their URLs, keyed by URL; filled as lookups answer. */
  versions?: Map<string, PdfVersion>;
  /** Set when the paper already has a PDF of this version: only a copy that outranks it is wanted. */
  betterThan?: PdfVersion;
}

/** What a resolver runs with: the host's network and logger. */
export interface ResolverEnv {
  fetch: FetchFn;
  logger: ILogger;
}

export interface PdfResolver {
  /** Stable short name for logs and the UI ("page", "publisher", "arxiv", ...). */
  readonly name: string;
  /** Candidate URLs, best first; an empty list when this resolver cannot help. A soft miss must not throw. */
  resolve(ctx: ResolveContext, env: ResolverEnv): Promise<string[]>;
}

export interface ResolvedPdf {
  bytes: Uint8Array;
  url: string;
  /** The resolver that suggested it. */
  source: string;
  /** Which version of the paper it is, when its source said so. */
  version?: PdfVersion;
}

/** How a download hop ended: the PDF, a bot check, a login or paywall, an HTML page without a PDF, or a failure. */
export type FetchOutcome = "pdf" | "bot" | "login" | "html" | "error";

/** One URL the chain tried and how its last hop ended, for the capture log and the "No PDF found" dialog. */
export interface PdfAttempt {
  source: string;
  url: string;
  outcome: FetchOutcome;
  /** HTTP status of that hop; absent on a network error or a tab fetch. */
  status?: number;
  /** Name of the library proxy `url` went through, when it did. */
  proxy?: string;
}

// Environment: what a lookup or download runs in, and logging through it under the module name "pdfFinding".

const MODULE = "pdfFinding";

const silentLogger: ILogger = {
  log: async () => undefined,
  error: async () => undefined,
};

/** The caller's fetch (or the global one, looked up at call time) wrapped so it is never called as a method. */
export function createResolverEnv(opts: PdfFetchOptions): ResolverEnv {
  const hostFetch = opts.fetch;
  return {
    fetch: hostFetch ? (...args: Parameters<FetchFn>) => hostFetch(...args) : (...args: Parameters<FetchFn>) => fetch(...args),
    logger: opts.logger ?? silentLogger,
  };
}

export function reportMessage(env: ResolverEnv, message: string, context: Record<string, unknown>): void {
  void env.logger.log("INFO", MODULE, message, context);
}

export function reportWarning(env: ResolverEnv, message: string, context: Record<string, unknown>): void {
  void env.logger.log("WARN", MODULE, message, context);
}

export function reportError(env: ResolverEnv, error: unknown, context: Record<string, unknown>): void {
  void env.logger.error(MODULE, error, context);
}

// URL parts: the origin and site of an absolute http(s) URL.

/** `url` parsed, or undefined when it is not an absolute http(s) URL. */
export function parseHttpUrl(url: string): URL | undefined {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** "https://host:port" in lower case, or undefined when `url` is not an absolute http(s) URL. */
export function deriveOrigin(url: string): string | undefined {
  return parseHttpUrl(url)?.origin;
}

/** The registrable part of the host ("www.nature.com" gives "nature.com"), or undefined when `url` has no host. */
export function deriveSite(url: string): string | undefined {
  return parseHttpUrl(url)?.hostname.split(".").slice(-2).join(".");
}

// Context: the finder's input built from what is known about a paper, so the mapping exists once.

interface ResolveOptions {
  contactEmail: string;
  /** Passing any is the user's opt-in; without them no custom host is contacted. */
  customResolvers?: readonly CustomResolver[] | undefined;
}

export function createResolveInput(
  ids: DetectedIds,
  metadata: ResolvedMetadata,
  landingUrl: string | undefined,
  pageCandidates: PdfCandidate[],
  options: ResolveOptions,
): ResolveContext {
  const doi = ids.doi ?? metadata.doi;
  const arxivId = ids.arxivId ?? extractArxivIdentifierFromDoi(doi);
  return {
    pageCandidates,
    contactEmail: options.contactEmail,
    ...(options.customResolvers?.length ? { customResolvers: options.customResolvers } : {}),
    ...(landingUrl ? { landingUrl } : {}),
    ...(doi ? { doi } : {}),
    ...(arxivId ? { arxivId } : {}),
    ...(ids.pmid ? { pmid: ids.pmid } : {}),
    ...(metadata.title ? { title: metadata.title } : {}),
    ...(metadata.authors?.length ? { authors: metadata.authors } : {}),
    ...(metadata.year !== undefined ? { year: metadata.year } : {}),
  };
}

// Resolution: finds a paper's PDF in two stages. Every lookup runs at once under a short cap, then the ranked candidates
// download a few at a time, with a bot wall retried through a real tab when the host offers one. Publisher pages that
// asked for a sign-in are retried last, through that tab and the library's proxies.

/**
 * Returns the best-ranked candidate that downloads as a PDF. `attempts` collects every URL tried, so a failure can be
 * explained.
 */
export async function resolvePdf(
  ctx: ResolveContext,
  opts: PdfFetchOptions = {},
  attempts: PdfAttempt[] = [],
): Promise<ResolvedPdf | undefined> {
  const env = createResolverEnv(opts);
  const lookups = new AbortController();
  const steps = startFinds(ctx, opts, env, DEFAULT_LIMITS.lookupCapMs, lookups.signal);
  const run = { opts, env, limits: DEFAULT_LIMITS };
  const found = await downloadBest(ctx, walkRankedCandidates(steps), run, attempts);
  // Lookups still running once a PDF won would only cost requests.
  lookups.abort();
  return found ?? runBestAccess(ctx, run, attempts);
}

// Search: looks for an identified paper's PDF through the resolver chain and logs what it tried when nothing downloads.

export interface PdfSearch extends Partial<ResolveOptions> {
  ids: DetectedIds;
  /** PubMed Central id in "PMC1234567" form, when the user typed one. */
  pmcid?: string;
  metadata: ResolvedMetadata;
  landingUrl?: string | undefined;
  pageCandidates?: PdfCandidate[];
  /** The version of the PDF the paper already has; set, only a copy that outranks it is looked for. */
  betterThan?: PdfVersion | undefined;
  /** What the user gave or the page the paper came from, to tell the log lines apart. */
  input: string;
}

/**
 * `attempts` collects every URL tried, so a miss can be explained to the user.
 * @returns the first candidate that downloads as a PDF, or undefined
 */
export async function findPaperPdf(
  fetchOptions: PdfFetchOptions,
  search: PdfSearch,
  attempts: PdfAttempt[] = [],
): Promise<ResolvedPdf | undefined> {
  const context = {
    ...createResolveInput(search.ids, search.metadata, search.landingUrl, search.pageCandidates ?? [], {
      contactEmail: search.contactEmail ?? DEFAULT_CONTACT_EMAIL,
      customResolvers: search.customResolvers,
    }),
    ...(search.pmcid ? { pmcid: search.pmcid } : {}),
    ...(search.betterThan ? { betterThan: search.betterThan } : {}),
  };
  const found = await resolvePdf(context, fetchOptions, attempts);
  const { logger } = createResolverEnv(fetchOptions);
  if (found) {
    await logger.log("INFO", "pdfFinding", "PDF found", { input: search.input, source: found.source, version: found.version, url: found.url, bytes: found.bytes.length });
  } else {
    await logger.log("INFO", "pdfFinding", "No PDF found", { input: search.input, attempts: attempts.map((a) => `${a.source}: ${a.url}`) });
  }
  return found;
}
