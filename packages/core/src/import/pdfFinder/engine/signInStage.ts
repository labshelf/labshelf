/** Retries the publisher pages that asked for a sign-in, through the user's real browser and then the library's proxies. */
import { info, warn } from "../env.js";
import { deadline, downloadCandidate, helperTabRetry, pacedFetch, type EngineLimits } from "./index.js";
import type { LibraryProxy, PdfAttempt, PdfFetchOptions, ResolveContext, ResolvedPdf, ResolverEnv } from "../pdfResolver.js";
import { originOf } from "../urlParts.js";
import { proxiedUrl } from "../client/index.js";
import { signInPages } from "./signInPages.js";

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
export async function accessBest(ctx: ResolveContext, run: AccessRun, attempts: PdfAttempt[]): Promise<ResolvedPdf | undefined> {
  const proxies = (run.opts.proxies ?? []).filter((p) => p.enabled);
  const pages = signInPages(attempts, ctx.landingUrl);
  if (!pages.length || (!run.opts.viaHelperTab && !proxies.length)) return undefined;
  info(run.env, "retrying sign-in pages", { pages: pages.map((p) => p.url), proxies: proxies.map((p) => p.name) });
  const total = deadline(run.limits.totalMs, "Access stage over its limit");
  try {
    return (await throughHelperTabs(pages, run, total.signal)) ?? (await throughProxies(pages, proxies, run, total.signal, attempts));
  } finally {
    total.clear();
  }
}

async function throughHelperTabs(pages: PdfAttempt[], { opts, env, limits }: AccessRun, signal: AbortSignal): Promise<ResolvedPdf | undefined> {
  if (!opts.viaHelperTab) return undefined;
  const retry = helperTabRetry(opts.viaHelperTab, env, limits.helperTabSites);
  for (const site of new Set(pages.map((p) => originOf(p.url)))) {
    const onSite = pages.filter((p) => originOf(p.url) === site);
    const pdf = await retry(onSite.map((p) => p.url), signal);
    if (pdf) return { bytes: pdf.bytes, url: pdf.url, source: onSite[0]!.source };
  }
  return undefined;
}

async function throughProxies(
  pages: PdfAttempt[], proxies: LibraryProxy[], { opts, env, limits }: AccessRun, signal: AbortSignal, attempts: PdfAttempt[],
): Promise<ResolvedPdf | undefined> {
  const pacedEnv: ResolverEnv = { ...env, fetch: pacedFetch(env.fetch, limits) };
  for (const proxy of proxies) {
    for (const page of pages.slice(0, PAGES_PER_PROXY)) {
      if (signal.aborted) return undefined;
      const url = proxiedUrl(proxy.template, page.url);
      if (!url) {
        warn(env, "library proxy template unreadable", { proxy: proxy.name, template: proxy.template });
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
