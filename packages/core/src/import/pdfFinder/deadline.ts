/** Sets the PDF finder's time and host limits and retries walled URLs through the host's helper tab. */
import { DOWNLOAD_LIMITS } from "./client.js";
import { deriveOrigin, reportWarning, type FetchedPdf, type PdfFetchOptions, type ResolverEnv } from "./finder.js";
import { formatError } from "../../errors/index.js";

// Sets how long the PDF finder waits and how hard it may press on one host.
export interface EngineLimits {
  /** Deadline of one lookup; a lookup that answers later is dropped. */
  lookupCapMs: number;
  /** Downloads in flight at once. */
  concurrency: number;
  /** Time to the response headers of one hop. */
  firstByteMs: number;
  /** All hops of one candidate URL. */
  perUrlMs: number;
  /** The whole download stage. */
  totalMs: number;
  /** How long a found PDF waits for a better-ranked candidate still in flight. */
  holdMs: number;
  /** Minimum gap between two requests to one host. */
  hostGapMs: number;
  /** Consecutive failed requests after which a host is skipped for the rest of the run. */
  hostMaxFailures: number;
  /** Sites a run may open a helper tab for, when the host has one. */
  helperTabSites: number;
}

// Publishers block bursts: one request per second per host, and a host that refused five times in a row is left alone.
export const DEFAULT_LIMITS: EngineLimits = {
  lookupCapMs: 3_000,
  concurrency: 3,
  ...DOWNLOAD_LIMITS,
  totalMs: 40_000,
  holdMs: 1_000,
  hostGapMs: 1_000,
  hostMaxFailures: 5,
  helperTabSites: 2,
};

// Retries walled URLs through the host's helper tab, one tab per site per run, however many candidates hit that wall.
// A tab costs seconds: it tries a few of the site's walled URLs, best first.
const URLS_PER_TAB = 3;

/** Fetches a candidate's walled URLs through a real tab; resolves to undefined when the wall still stands. */
export type HelperTabRetry = (blocked: string[], signal: AbortSignal) => Promise<FetchedPdf | undefined>;

/**
 * Opens at most `maxSites` helper tabs in a run. A candidate walled on a site whose tab is already open gets no tab of
 * its own: it waits for that tab and reports the wall, because the tab's PDF belongs to the candidate that opened it.
 */
export function runHelperTabRetry(
  viaHelperTab: NonNullable<PdfFetchOptions["viaHelperTab"]>,
  env: ResolverEnv,
  maxSites: number,
): HelperTabRetry {
  const bySite = new Map<string, Promise<FetchedPdf | undefined>>();
  return async (blocked, signal) => {
    const site = deriveOrigin(blocked[0] ?? "");
    if (!site) return undefined;
    const open = bySite.get(site);
    if (open) return open.then(() => undefined);
    if (bySite.size >= maxSites) return undefined;
    const urls = [...new Set(blocked)].filter((u) => deriveOrigin(u) === site).slice(0, URLS_PER_TAB);
    const run = viaHelperTab(urls, signal).catch((error: unknown) => {
      if (!signal.aborted) reportWarning(env, "helper tab failed", { urls, error: formatError(error) });
      return undefined;
    });
    bySite.set(site, run);
    return run;
  };
}
