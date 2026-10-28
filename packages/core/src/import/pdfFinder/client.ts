/** Downloads PDF candidates: follows HTML answers to the file, recognises bot checks and rewrites URLs through a library proxy. */
import {
  createResolverEnv, deriveSite, parseHttpUrl, reportWarning,
  type FetchedPdf, type FetchOutcome, type InTabAnswer, type PdfFetchOptions, type ResolverEnv,
} from "./finder.js";
import { listPdfUrlsForLanding } from "./rules.js";
import { formatError } from "../../errors/index.js";
import { isPdfBytes } from "../../library/index.js";
import { hostOf } from "../../url/index.js";
import { parseHtmlPage, findRedirectUrls } from "../htmlPage.js";
import { derivePageFacts } from "../pageFacts.js";

// Lists the markers that bot-protection services leave in their challenge answers.
/** Reads one response header by name, as `Headers.get` does. */
interface HeaderReader {
  get(name: string): string | null;
}

/**
 * Markers specific enough to mean a wall on any status, even a 200:
 * F5/Fastly (Springer, eLife, JSTOR), AWS WAF (IEEE, De Gruyter, figshare), Anubis (HAL, DBLP),
 * the PMC proof-of-work, Imperva (Project Euclid, SPIE), HighWire's script check and MDPI's interstitial.
 */
const WALL_BODY = new RegExp(
  [
    "<title>\\s*Client Challenge\\s*</title>",
    "/_fs-ch-",
    "token\\.awswaf\\.com",
    "anubis_challenge",
    "POW_CHALLENGE",
    "cloudpmc-viewer-pow",
    "_Incapsula_Resource",
    "function leastFactor\\(",
    "/_sec/verify\\?provider=interstitial",
  ].join("|"),
  "i",
);

const RADWARE_HOST = "validate.perfdrive.com";

/** True when the page text, the final URL or a header names a wall. */
function hasWallSignature(html: string, finalUrl: string | undefined, headers: HeaderReader | undefined): boolean {
  if (WALL_BODY.test(html)) return true;
  if (finalUrl && hostOf(finalUrl) === RADWARE_HOST) return true;
  const waf = headers?.get("x-amzn-waf-action")?.toLowerCase();
  return waf === "challenge" || waf === "captcha" || headers?.get("cf-mitigated")?.toLowerCase() === "challenge";
}

/**
 * True for Imperva's `x-iinfo` header. TRAP: Imperva adds it to every answer of a protected site, so it only
 * means a wall together with a challenge status.
 */
function hasImpervaHeader(headers: HeaderReader | undefined): boolean {
  return headers?.get("x-iinfo") != null;
}

// Recognises the pages that bot-protection services answer instead of the publisher's content.
// Generic words appear on ordinary pages too ("cloudflare" in a footer), so they count only with a challenge status.
const GENERIC_BOT_CHECK = /just a moment|attention required|checking your browser|cf-browser-verification|challenge-platform|cf_chl_|cloudflare|captcha|access denied|are you a robot|unusual traffic|problem providing the content/i;
const CHALLENGE_STATUSES = new Set([202, 403, 429, 503]);
// A rendered page has no status, so only a challenge's title or Cloudflare's own markup counts.
const CHALLENGE_PAGE = /<title>\s*(just a moment|attention required|checking your browser|um momento|access denied)|challenges\.cloudflare\.com|cf_chl_opt|cf-browser-verification|id="challenge-(form|stage|running|error-text)"/i;

/** What a response shows beyond its status and body. */
export interface BotCheckOptions {
  finalUrl?: string;
  headers?: HeaderReader;
}

/** True when a response is a bot check rather than the publisher's answer. */
export function isBotCheck(status: number, html: string, { finalUrl, headers }: BotCheckOptions = {}): boolean {
  if (hasWallSignature(html, finalUrl, headers)) return true;
  if (!CHALLENGE_STATUSES.has(status)) return false;
  if (hasImpervaHeader(headers)) return true;
  // Block pages inline whole font files first; the telling words come after.
  return GENERIC_BOT_CHECK.test(html.replace(/<style[\s\S]*?<\/style>/gi, ""));
}

/** True when a page a tab rendered (its markup and address) is still a bot check rather than the site's own page. */
export function isWallPage(html: string, url: string): boolean {
  return hasWallSignature(html, url, undefined) || CHALLENGE_PAGE.test(html);
}

// Recognises links to a paper's supplementary material, which aggregators sometimes list as its PDF.
// Springer/Nature `MediaObjects/..._ESM.pdf`, Atypon `/doi/suppl/`, Wiley `downloadSupplement`, and paths that say so.
const SUPPLEMENTARY = /\/MediaObjects\/|_ESM\.pdf\b|\/suppl(?:_file)?\/|downloadSupplement|supplementary/i;

/** True when `url` points at supplementary material rather than the article itself. */
export function isSupplementaryUrl(url: string): boolean {
  return SUPPLEMENTARY.test(url.replace(/[?#].*$/, ""));
}

// Reads an HTML answer to a PDF request for where the PDF actually is.
const MAX_HOPS_PER_PAGE = 4;

/**
 * Where an HTML answer points next (meta refresh, scripted redirect, the publisher rule for the page, viewer and PDF
 * links), best guess first. The rule applies to every landing page a hop reaches: a doi.org redirect, an aggregator's link.
 */
export function extractNextHopsFromHtml(html: string, url: string): string[] {
  const facts = derivePageFacts(parseHtmlPage(html, url));
  const hops = [...findRedirectUrls(html, url), ...listPdfUrlsForLanding(url), ...facts.pdfCandidates.map((c) => c.url)];
  // A paywalled article page still links its supplements; one would download fine and be the wrong document.
  return [...new Set(hops)].filter((u) => u !== url && !isSupplementaryUrl(u)).slice(0, MAX_HOPS_PER_PAGE);
}

// Classifies one fetch hop as a PDF, a bot check, a login or paywall, a plain HTML page or an error.
/** What a hop came back with; `html` is the decoded body of an HTML or non-OK answer. */
export interface FetchFacts {
  status: number;
  finalUrl: string;
  /** Start of the body when it was read as a download. */
  bytes?: Uint8Array;
  html?: string;
  /** The response headers, for the walls that announce themselves there. */
  headers?: HeaderReader;
}

const PASSWORD_FIELD = /<input\b[^>]*\btype\s*=\s*["']?password/i;
const LOGIN_WORDS = /sign in|log ?in,? or register|log in via an institution|access through your institution|purchase|get access/i;

/** True for a page that asks for credentials or payment instead of showing the article. */
function isLoginWall(html: string): boolean {
  const markup = html.replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, "");
  return PASSWORD_FIELD.test(markup) || LOGIN_WORDS.test(markup.replace(/<[^>]*>/g, " "));
}

export function deriveFetchOutcome({ status, finalUrl, bytes, html, headers }: FetchFacts): FetchOutcome {
  if (bytes && isPdfBytes(bytes)) return "pdf";
  if (isBotCheck(status, html ?? "", { finalUrl, ...(headers ? { headers } : {}) })) return "bot";
  if (status === 401 || status === 403) return "login";
  if (status < 200 || status >= 300 || html === undefined) return "error";
  // A page that still offers a PDF or a redirect is a hop to follow, whatever else it says.
  if (extractNextHopsFromHtml(html, finalUrl).length) return "html";
  return isLoginWall(html) ? "login" : "html";
}

// Rewrites a URL to go through a library proxy, in the three shapes libraries use: a prefix, a hostname suffix or OpenAthens.
/**
 * - `prefix`: the template holds `$@` where the URL goes ("https://login.ezproxy.uni.edu/login?url=$@").
 * - `hostname`: the template is the proxy's domain (".ezproxy.uni.edu"), and the publisher's host is folded into it.
 * - `openathens`: the template is the library's OpenAthens redirector ("https://go.openathens.net/redirector/uni.edu").
 */
export type ProxyKind = "prefix" | "hostname" | "openathens";

const OPENATHENS = /^https:\/\/go\.openathens\.net\/redirector\/([a-z0-9.-]+)\/?(?:\?url=(?:\$@)?)?$/i;
const HOSTNAME_SUFFIX = /^\.?((?:[a-z0-9-]+\.)+[a-z]{2,})$/i;

/** How `template` rewrites URLs, or undefined when it is none of the three shapes. */
export function deriveProxyKind(template: string): ProxyKind | undefined {
  const t = template.trim();
  if (OPENATHENS.test(t)) return "openathens";
  if (t.includes("$@")) return parseHttpUrl(t.replace("$@", "x")) ? "prefix" : undefined;
  return HOSTNAME_SUFFIX.test(t) ? "hostname" : undefined;
}

/** `url` as fetched through the proxy, or undefined when the template or the URL cannot be read. */
export function createProxiedUrl(template: string, url: string): string | undefined {
  const t = template.trim();
  const target = parseHttpUrl(url);
  if (!target) return undefined;
  switch (deriveProxyKind(t)) {
    case "openathens":
      return `https://go.openathens.net/redirector/${OPENATHENS.exec(t)![1]}?url=${encodeURIComponent(url)}`;
    case "prefix":
      return t.replace("$@", url);
    case "hostname":
      return `${target.protocol}//${foldHost(target.hostname)}.${HOSTNAME_SUFFIX.exec(t)![1]}${target.pathname}${target.search}`;
    default:
      return undefined;
  }
}

// TRAP: EZproxy's proxy-by-hostname doubles the hyphens a host already has before it turns the dots into hyphens, so
// "www.ams-journal.org" is "www-ams--journal-org"; a single hyphen would name another host.
function foldHost(hostname: string): string {
  return hostname.replace(/-/g, "--").replace(/\./g, "-");
}

// Downloads a candidate URL and follows HTML answers to the PDF, up to a few hops.
// Last resort: a same-site URL is fetched from inside the tab, which reuses the page's session.
const MAX_PDF_BYTES = 200 * 1024 * 1024;
const MAX_HTML_BYTES = 4 * 1024 * 1024;

interface FetchAnswer {
  finalUrl: string;
  outcome: FetchOutcome;
  /** Absent when the request failed before any response. */
  status?: number;
  pdf?: FetchedPdf;
  html?: string;
}

/** How one candidate's hops are sent: its deadline, the wait for response headers, and the article page as Referer. */
export interface HopSettings {
  signal: AbortSignal;
  firstByteMs: number;
  referer?: string;
}

type RequestSettings = Pick<PdfFetchOptions, "credentials" | "headers"> & HopSettings;

/** @returns what the URL answered and how that answer classifies; an `error` outcome for a network failure or an unusable response */
async function fetchOnce(url: string, env: ResolverEnv, settings: RequestSettings): Promise<FetchAnswer> {
  const firstByte = new AbortController();
  const timer = setTimeout(() => firstByte.abort(new DOMException("No response headers in time", "TimeoutError")), settings.firstByteMs);
  try {
    const res = await env.fetch(url, {
      redirect: "follow",
      signal: AbortSignal.any([settings.signal, firstByte.signal]),
      ...(settings.credentials ? { credentials: settings.credentials } : {}),
      ...requestHeaders(settings),
    });
    clearTimeout(timer);
    const finalUrl = res.url || url;
    const { status } = res;
    if (!res.ok || status === 202) {
      const html = await res.text().catch(() => "");
      return { finalUrl, status, outcome: deriveFetchOutcome({ status, finalUrl, html, headers: res.headers }) };
    }
    if (Number(res.headers.get("content-length") ?? "0") > MAX_PDF_BYTES) return { finalUrl, status, outcome: "error" };
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > MAX_PDF_BYTES) return { finalUrl, status, outcome: "error" };
    const type = (res.headers.get("content-type") ?? "").toLowerCase();
    const isHtml = !isPdfBytes(bytes) && bytes.length <= MAX_HTML_BYTES && (type.includes("html") || type === "");
    const html = isHtml ? new TextDecoder().decode(bytes) : undefined;
    const outcome = deriveFetchOutcome({ status, finalUrl, bytes, headers: res.headers, ...(html !== undefined ? { html } : {}) });
    return {
      finalUrl, status, outcome,
      ...(outcome === "pdf" ? { pdf: { bytes, url: finalUrl } } : {}),
      ...(html !== undefined ? { html } : {}),
    };
  } catch (error) {
    // A download the run cancelled because another one won is not a failure worth a line.
    if ((error as { name?: unknown } | null)?.name !== "AbortError") reportWarning(env, "download failed", { url, error: formatError(error) });
    return { finalUrl: url, outcome: "error" };
  } finally {
    clearTimeout(timer);
  }
}

// PLATFORM: browsers drop a Referer header set through fetch (a forbidden header name); Node sends it.
function requestHeaders({ headers, referer }: RequestSettings): { headers?: Record<string, string> } {
  if (!referer) return headers ? { headers } : {};
  return { headers: { ...headers, Referer: referer } };
}

// TRAP: a response is a PDF only by its bytes, never its headers; publishers answer with login pages, cookie walls or "loading" interstitials as often as with the file.
const MAX_HOPS = 3;

/** Deadlines of one candidate URL: the wait for each hop's response headers, and all its hops together. */
export const DOWNLOAD_LIMITS = { firstByteMs: 10_000, perUrlMs: 30_000 };

// The outcome an attempt reports is the most telling one on its chain: a login hop followed by a failed hop is a login.
const TELLING: Record<FetchOutcome, number> = { pdf: 4, bot: 3, login: 2, error: 1, html: 0 };

/** The PDF (if any), the URLs a bot check refused (which a real tab may still get through), and how the last hop ended. */
export interface DownloadOutcome {
  pdf?: FetchedPdf;
  blocked: string[];
  outcome: FetchOutcome;
  status?: number;
}

/** @returns The PDF bytes and final URL, or undefined when the URL leads to no PDF. */
export async function fetchPdf(url: string, opts: PdfFetchOptions = {}): Promise<FetchedPdf | undefined> {
  const hop = { signal: AbortSignal.timeout(DOWNLOAD_LIMITS.perUrlMs), firstByteMs: DOWNLOAD_LIMITS.firstByteMs };
  return (await downloadPdf(url, opts, createResolverEnv(opts), hop)).pdf;
}

/** Follows `url` and at most MAX_HOPS interstitials behind it until a PDF, collecting the URLs a bot check refused. */
export async function downloadPdf(url: string, opts: PdfFetchOptions, env: ResolverEnv, hop: HopSettings): Promise<DownloadOutcome> {
  const blocked: string[] = [];
  const visited = new Set<string>();
  let frontier = [url];
  let telling: Pick<DownloadOutcome, "outcome" | "status"> | undefined;
  for (let depth = 0; depth <= MAX_HOPS && frontier.length && !hop.signal.aborted; depth++) {
    const next: string[] = [];
    for (const target of frontier) {
      if (visited.has(target)) continue;
      visited.add(target);
      const answer = await fetchOnce(target, env, { ...opts, ...hop });
      if (!telling || TELLING[answer.outcome] > TELLING[telling.outcome]) {
        telling = { outcome: answer.outcome, ...(answer.status !== undefined ? { status: answer.status } : {}) };
      }
      if (answer.pdf) return { pdf: answer.pdf, blocked, outcome: "pdf", ...(answer.status !== undefined ? { status: answer.status } : {}) };
      if (answer.outcome === "bot") {
        blocked.push(target);
        reportWarning(env, "bot check", { url: target, finalUrl: answer.finalUrl });
      } else if (answer.html) {
        next.push(...extractNextHopsFromHtml(answer.html, answer.finalUrl));
      }
      const inTab = await fetchThroughTab(target, opts);
      if (inTab?.pdf) return { pdf: inTab.pdf, blocked, outcome: "pdf" };
      if (inTab?.html) next.push(...extractNextHopsFromHtml(inTab.html, inTab.finalUrl));
    }
    frontier = next.filter((u) => !visited.has(u));
  }
  return { blocked, ...(telling ?? { outcome: "error" }) };
}

async function fetchThroughTab(url: string, opts: PdfFetchOptions): Promise<InTabAnswer | undefined> {
  return opts.tab && sameSite(url, opts.tab.url) ? opts.tab.fetchInTab(url) : undefined;
}

function sameSite(url: string, tabUrl: string): boolean {
  const site = deriveSite(url);
  return site !== undefined && site === deriveSite(tabUrl);
}
