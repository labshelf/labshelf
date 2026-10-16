/** Declares the PDF finder's shapes: what a resolver knows, what it proposes, and the ports a host supplies for downloading. */
import type { PdfVersion } from "../../model/index.js";
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
   * the first that is a PDF. The run aborts `signal` once it no longer needs the answer.
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
