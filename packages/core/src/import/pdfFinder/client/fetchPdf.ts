// Downloads a candidate URL and follows HTML answers to the PDF, up to a few hops.
// Last resort: a same-site URL is fetched from inside the tab, which reuses the page's session.
import { makeEnv, warn } from "../env.js";
import type { FetchedPdf, FetchOutcome, InTabAnswer, PdfFetchOptions, ResolverEnv } from "../pdfResolver.js";
import { siteOf } from "../urlParts.js";
import { fetchOnce, type HopSettings } from "./fetchOnce.js";
import { nextHopsFromHtml } from "./hops.js";

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
  return (await downloadPdf(url, opts, makeEnv(opts), hop)).pdf;
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
        warn(env, "bot check", { url: target, finalUrl: answer.finalUrl });
      } else if (answer.html) {
        next.push(...nextHopsFromHtml(answer.html, answer.finalUrl));
      }
      const inTab = await fetchThroughTab(target, opts);
      if (inTab?.pdf) return { pdf: inTab.pdf, blocked, outcome: "pdf" };
      if (inTab?.html) next.push(...nextHopsFromHtml(inTab.html, inTab.finalUrl));
    }
    frontier = next.filter((u) => !visited.has(u));
  }
  return { blocked, ...(telling ?? { outcome: "error" }) };
}

async function fetchThroughTab(url: string, opts: PdfFetchOptions): Promise<InTabAnswer | undefined> {
  return opts.tab && sameSite(url, opts.tab.url) ? opts.tab.fetchInTab(url) : undefined;
}

function sameSite(url: string, tabUrl: string): boolean {
  const site = siteOf(url);
  return site !== undefined && site === siteOf(tabUrl);
}
