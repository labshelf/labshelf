/** Declares the PDF finder's shapes: what a resolver knows, what it proposes, and the ports a host supplies for downloading. */
import type { ILogger } from "../../ports/index.js";
import type { PdfCandidate } from "../landing/index.js";

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

export interface PdfFetchOptions {
  fetch?: FetchFn;
  /** "include" sends the user's cookies, so a paper the user can open through an institutional login downloads too. */
  credentials?: "include" | "omit";
  headers?: Record<string, string>;
  logger?: ILogger;
  tab?: TabPort;
  /** Loads URLs of one site through a real (background) tab, for candidates a bot check refused. */
  viaHelperTab?: (urls: string[]) => Promise<FetchedPdf | undefined>;
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
  /** Sci-Hub mirror base URL. Its presence is the user's opt-in; without it Sci-Hub is never contacted. */
  sciHubMirror?: string;
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
}
