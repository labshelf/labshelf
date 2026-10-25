/** Retries the publisher pages that asked for a sign-in, through the user's real browser and then the library's proxies. */
import { reportMessage, reportWarning } from "../env.js";
import { createDeadline, downloadCandidate, runHelperTabRetry, createPacedFetch, type EngineLimits } from "./index.js";
import type {
  LibraryProxy,
  PdfAttempt,
  PdfFetchOptions,
  ResolveContext,
  ResolvedPdf,
  ResolverEnv,
} from "../pdfResolver.js";
import { deriveOrigin, parseHttpUrl, deriveSite } from "../urlParts.js";
import { createProxiedUrl } from "../client/index.js";
import { deriveHostAccess } from "../rules/index.js";

/**
 * The `login` attempts on the article's own site or on a paywalled platform of the rule table, best-ranked first and
 * each URL once. A repository or an open-access platform that refuses a page is not one a library can open.
 */
function signInPages(attempts: readonly PdfAttempt[], landingUrl: string | undefined): PdfAttempt[] {
  const articleSite = landingUrl ? deriveSite(landingUrl) : undefined;
  const seen = new Set<string>();
  return attempts.filter((a) => {
    const host = parseHttpUrl(a.url)?.hostname;
    if (a.outcome !== "login" || a.proxy !== undefined || !host || seen.has(a.url)) return false;
    seen.add(a.url);
    const access = deriveHostAccess(host);
    return access === "paywalled" || (access === undefined && articleSite !== undefined && deriveSite(a.url) === articleSite);
  });
}

// A library that opens one page of a platform opens the rest, so each proxy gets only the few best-ranked pages.
const PAGES_PER_PROXY = 3;

interface AccessRun {
  opts: PdfFetchOptions;
  env: ResolverEnv;
  limits: EngineLimits;
}

/**
 * Runs once the open-access candidates found nothing. Each sign-in page goes through the host's helper tab, whose
 * session may hold an institutional login that background requests lack, then through each enabled proxy in order.
 * Proxied tries are appended to `attempts` with the proxy's name.
 */
export async function runBestAccess(ctx: ResolveContext, run: AccessRun, attempts: PdfAttempt[]): Promise<ResolvedPdf | undefined> {
  const proxies = (run.opts.proxies ?? []).filter((p) => p.enabled);
  const pages = signInPages(attempts, ctx.landingUrl);
  if (!pages.length || (!run.opts.viaHelperTab && !proxies.length)) return undefined;
  reportMessage(run.env, "retrying sign-in pages", { pages: pages.map((p) => p.url), proxies: proxies.map((p) => p.name) });
  const total = createDeadline(run.limits.totalMs, "Access stage over its limit");
  try {
    return (await throughHelperTabs(pages, run, total.signal)) ?? (await throughProxies(pages, proxies, run, total.signal, attempts));
  } finally {
    total.clear();
  }
}

async function throughHelperTabs(pages: PdfAttempt[], { opts, env, limits }: AccessRun, signal: AbortSignal): Promise<ResolvedPdf | undefined> {
  if (!opts.viaHelperTab) return undefined;
  const retry = runHelperTabRetry(opts.viaHelperTab, env, limits.helperTabSites);
  for (const site of new Set(pages.map((p) => deriveOrigin(p.url)))) {
    const onSite = pages.filter((p) => deriveOrigin(p.url) === site);
    const pdf = await retry(onSite.map((p) => p.url), signal);
    if (pdf) return { bytes: pdf.bytes, url: pdf.url, source: onSite[0]!.source };
  }
  return undefined;
}

async function throughProxies(
  pages: PdfAttempt[], proxies: LibraryProxy[], { opts, env, limits }: AccessRun, signal: AbortSignal, attempts: PdfAttempt[],
): Promise<ResolvedPdf | undefined> {
  const pacedEnv: ResolverEnv = { ...env, fetch: createPacedFetch(env.fetch, limits) };
  for (const proxy of proxies) {
    for (const page of pages.slice(0, PAGES_PER_PROXY)) {
      if (signal.aborted) return undefined;
      const url = createProxiedUrl(proxy.template, page.url);
      if (!url) {
        reportWarning(env, "library proxy template unreadable", { proxy: proxy.name, template: proxy.template });
        break;
      }
      const got = await downloadCandidate(url, undefined, opts, pacedEnv, limits, signal);
      attempts.push({ source: page.source, url, outcome: got.outcome, ...(got.status !== undefined ? { status: got.status } : {}), proxy: proxy.name });
      if (got.pdf) return { bytes: got.pdf.bytes, url: got.pdf.url, source: page.source };
      // A proxy that asks for its own sign-in, or walls the run off, answers every page the same way.
      if (got.outcome === "login" || got.outcome === "bot") break;
    }
  }
  return undefined;
}
