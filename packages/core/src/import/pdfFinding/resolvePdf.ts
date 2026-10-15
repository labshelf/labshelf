/**
 * Finds a paper's PDF in two stages: every lookup runs at once under a short cap, then the ranked candidates download a
 * few at a time. Candidates a bot check refused are retried at the end through a real tab, when the host offers one.
 */
import { DEFAULT_LIMITS, downloadBest, rankedCandidates, startLookups } from "./engine/index.js";
import { makeEnv, warn } from "./env.js";
import { originOf } from "./urlParts.js";
import type { FetchedPdf, PdfAttempt, PdfFetchOptions, ResolveContext, ResolvedPdf, ResolverEnv } from "./types.js";
import { errorMessage } from "../../logging/index.js";

// A background tab costs seconds: one tab, for the site of the first blocked candidate, which then tries that
// site's blocked candidates in order.
const HELPER_TAB_URLS = 3;
const VIA_TAB = "(via tab)";

/**
 * Returns the best-ranked candidate that downloads as a PDF. `attempts` collects every URL tried, so a failure can be
 * explained.
 */
export async function resolvePdf(
  ctx: ResolveContext,
  opts: PdfFetchOptions = {},
  attempts: PdfAttempt[] = [],
): Promise<ResolvedPdf | undefined> {
  const env = makeEnv(opts);
  const lookups = new AbortController();
  const steps = startLookups(ctx, opts, env, DEFAULT_LIMITS.lookupCapMs, lookups.signal);
  const run = { opts, env, limits: DEFAULT_LIMITS };
  const { found, blocked } = await downloadBest(ctx, rankedCandidates(steps), run, attempts);
  // Lookups still running once a PDF won would only cost requests.
  lookups.abort();
  if (found) return found;
  return opts.viaHelperTab && blocked.length ? retryThroughTab(opts.viaHelperTab, blocked, attempts, env) : undefined;
}

async function retryThroughTab(
  viaHelperTab: NonNullable<PdfFetchOptions["viaHelperTab"]>,
  blocked: string[],
  attempts: PdfAttempt[],
  env: ResolverEnv,
): Promise<ResolvedPdf | undefined> {
  const site = originOf(blocked[0]!);
  const urls = [...new Set(blocked)].filter((u) => originOf(u) === site).slice(0, HELPER_TAB_URLS);
  let pdf: FetchedPdf | undefined;
  try {
    pdf = await viaHelperTab(urls);
  } catch (error) {
    warn(env, "helper tab failed", { urls, error: errorMessage(error) });
  }
  // The tab reports one PDF for the whole batch; the rest were still refused.
  const winner = pdf ? urls.find((u) => u === pdf.url) ?? urls[0] : undefined;
  attempts.push(...urls.map((url) => ({ source: `${sourceOf(attempts, url)} ${VIA_TAB}`, url, outcome: url === winner ? "pdf" as const : "bot" as const })));
  return pdf ? { bytes: pdf.bytes, url: pdf.url, source: sourceOf(attempts, pdf.url, urls) } : undefined;
}

// The resolver that first proposed `url` (or, for a redirected download, the first of the URLs handed to the tab).
function sourceOf(attempts: PdfAttempt[], url: string, fallbackFrom: string[] = []): string {
  const direct = (u: string): PdfAttempt | undefined => attempts.find((a) => a.url === u && !a.source.endsWith(VIA_TAB));
  return direct(url)?.source ?? fallbackFrom.map(direct).find(Boolean)?.source ?? "page";
}
