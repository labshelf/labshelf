/**
 * Finds a paper's PDF in two stages: every lookup runs at once under a short cap, then the ranked candidates download a
 * few at a time, with a bot wall retried through a real tab when the host offers one. Publisher pages that asked for a
 * sign-in are retried last, through that tab and the library's proxies.
 */
import { accessBest } from "./access/index.js";
import { DEFAULT_LIMITS, downloadBest, rankedCandidates, startLookups } from "./engine/index.js";
import { makeEnv } from "./env.js";
import type { PdfAttempt, PdfFetchOptions, ResolveContext, ResolvedPdf } from "./types.js";

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
  const found = await downloadBest(ctx, rankedCandidates(steps), run, attempts);
  // Lookups still running once a PDF won would only cost requests.
  lookups.abort();
  return found ?? accessBest(ctx, run, attempts);
}
