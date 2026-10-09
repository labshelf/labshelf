/**
 * Downloads a candidate URL and proves it is the PDF by its bytes, never by headers: publishers answer a PDF link
 * with a login page, a cookie wall or a "your PDF is loading" interstitial as often as with the file. When the
 * answer is HTML, it is read for where the PDF actually is and that is followed, a few hops at most. As a last
 * resort a URL on the tab's own site is fetched from inside the tab, which reproduces the page's exact session.
 */
import { makeEnv, warn } from "../env.js";
import type { FetchedPdf, InTabAnswer, PdfFetchOptions, ResolverEnv } from "../types.js";
import { siteOf } from "../urlParts.js";
import { fetchOnce } from "./fetchOnce.js";
import { nextHopsFromHtml } from "./nextHops.js";

const MAX_HOPS = 3;

/** The PDF (if any) plus the URLs a bot check refused, which a real tab may still get through. */
export interface DownloadOutcome {
  pdf?: FetchedPdf;
  blocked: string[];
}

/** @returns The PDF bytes and final URL, or undefined when the URL leads to no PDF. */
export async function fetchPdf(url: string, opts: PdfFetchOptions = {}): Promise<FetchedPdf | undefined> {
  return (await downloadPdf(url, opts, makeEnv(opts))).pdf;
}

/** Follows `url` and at most MAX_HOPS interstitials behind it until a PDF, collecting the URLs a bot check refused. */
export async function downloadPdf(url: string, opts: PdfFetchOptions, env: ResolverEnv): Promise<DownloadOutcome> {
  const blocked: string[] = [];
  const visited = new Set<string>();
  let frontier = [url];
  for (let hop = 0; hop <= MAX_HOPS && frontier.length; hop++) {
    const next: string[] = [];
    for (const target of frontier) {
      if (visited.has(target)) continue;
      visited.add(target);
      const answer = await fetchOnce(target, env, opts);
      if (answer?.pdf) return { pdf: answer.pdf, blocked };
      if (answer?.blocked) {
        blocked.push(target);
        warn(env, "bot check", { url: target, finalUrl: answer.finalUrl });
      } else if (answer?.html) {
        next.push(...nextHopsFromHtml(answer.html, answer.finalUrl));
      }
      const inTab = await fetchThroughTab(target, opts);
      if (inTab?.pdf) return { pdf: inTab.pdf, blocked };
      if (inTab?.html) next.push(...nextHopsFromHtml(inTab.html, inTab.finalUrl));
    }
    frontier = next.filter((u) => !visited.has(u));
  }
  return { blocked };
}

async function fetchThroughTab(url: string, opts: PdfFetchOptions): Promise<InTabAnswer | undefined> {
  return opts.tab && sameSite(url, opts.tab.url) ? opts.tab.fetchInTab(url) : undefined;
}

function sameSite(url: string, tabUrl: string): boolean {
  const site = siteOf(url);
  return site !== undefined && site === siteOf(tabUrl);
}
