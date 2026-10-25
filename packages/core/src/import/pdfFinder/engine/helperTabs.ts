/** Retries walled URLs through the host's helper tab, one tab per site per run, however many candidates hit that wall. */
import { reportWarning } from "../env.js";
import type { FetchedPdf, PdfFetchOptions, ResolverEnv } from "../pdfResolver.js";
import { deriveOrigin } from "../urlParts.js";
import { formatError } from "../../../logging/index.js";

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
