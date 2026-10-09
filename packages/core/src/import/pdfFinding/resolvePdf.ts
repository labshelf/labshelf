/**
 * Runs the resolvers in order and downloads each one's candidate URLs before asking the next, until one really is a
 * PDF. Candidates a bot check refused are retried at the end through a real tab, when the host offers one.
 */
import { downloadPdf, isSupplementaryUrl } from "./download/index.js";
import { makeEnv, reportError, warn } from "./env.js";
import { RESOLVER_ORDER } from "./resolverOrder.js";
import { originOf } from "./urlParts.js";
import type { PdfAttempt, PdfFetchOptions, PdfResolver, ResolveContext, ResolvedPdf, ResolverEnv } from "./types.js";

// A background tab costs seconds: one tab, for the site of the first blocked candidate, which then tries that
// site's blocked candidates in order.
const HELPER_TAB_URLS = 3;
const VIA_TAB = "(via tab)";

/**
 * Walks the chain and returns the first candidate that downloads as a PDF. `attempts` collects every URL tried, so
 * a failure can be explained.
 */
export async function resolvePdf(
  ctx: ResolveContext,
  opts: PdfFetchOptions = {},
  attempts: PdfAttempt[] = [],
): Promise<ResolvedPdf | undefined> {
  const env = makeEnv(opts);
  const blocked: string[] = [];
  const tried = new Set<string>();
  for (const resolver of RESOLVER_ORDER) {
    for (const url of await candidatesOf(resolver, ctx, env)) {
      if (tried.has(url)) continue;
      tried.add(url);
      // An aggregator can list a supplement as the paper's PDF; it would download fine and be the wrong document.
      if (isSupplementaryUrl(url)) continue;
      const source = sourceLabel(resolver, ctx, url);
      attempts.push({ source, url });
      const outcome = await downloadPdf(url, opts, env);
      blocked.push(...outcome.blocked);
      if (outcome.pdf) return { bytes: outcome.pdf.bytes, url: outcome.pdf.url, source };
    }
  }
  return opts.viaHelperTab && blocked.length ? retryThroughTab(opts.viaHelperTab, blocked, attempts, env) : undefined;
}

async function candidatesOf(resolver: PdfResolver, ctx: ResolveContext, env: ResolverEnv): Promise<string[]> {
  try {
    return await resolver.resolve(ctx, env);
  } catch (error) {
    reportError(env, error, { resolver: resolver.name });
    return [];
  }
}

// Page links keep the label of whoever offered them ("page", "scholar").
function sourceLabel(resolver: PdfResolver, ctx: ResolveContext, url: string): string {
  return resolver.name === "page" ? ctx.pageCandidates.find((c) => c.url === url)?.source ?? resolver.name : resolver.name;
}

async function retryThroughTab(
  viaHelperTab: NonNullable<PdfFetchOptions["viaHelperTab"]>,
  blocked: string[],
  attempts: PdfAttempt[],
  env: ResolverEnv,
): Promise<ResolvedPdf | undefined> {
  const site = originOf(blocked[0]!);
  const urls = [...new Set(blocked)].filter((u) => originOf(u) === site).slice(0, HELPER_TAB_URLS);
  attempts.push(...urls.map((url) => ({ source: `${sourceOf(attempts, url)} ${VIA_TAB}`, url })));
  try {
    const pdf = await viaHelperTab(urls);
    return pdf ? { bytes: pdf.bytes, url: pdf.url, source: sourceOf(attempts, pdf.url, urls) } : undefined;
  } catch (error) {
    warn(env, "helper tab failed", { urls, error: error instanceof Error ? error.message : String(error) });
    return undefined;
  }
}

// The resolver that first proposed `url` (or, for a redirected download, the first of the URLs handed to the tab).
function sourceOf(attempts: PdfAttempt[], url: string, fallbackFrom: string[] = []): string {
  const direct = (u: string): PdfAttempt | undefined => attempts.find((a) => a.url === u && !a.source.endsWith(VIA_TAB));
  return direct(url)?.source ?? fallbackFrom.map(direct).find(Boolean)?.source ?? "page";
}
