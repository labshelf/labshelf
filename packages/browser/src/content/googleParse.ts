// Reads organic Google web results into SearchHit records, and keeps only the ones that are papers.
// The parser keys on the result link and its h3, never on Google's generated class names.
import { isScholarlyHost } from "@labshelf/core";
import type { SearchHit } from "../platform";
import { idsFromHit } from "./searchHitIds";

// Google's own hosts: www.google.com and its country domains. The manifest glob
// "www.google.*" alone would also match www.google.<anything>.com.
const GOOGLE_HOST = /^www\.google\.(?:com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/;
// "Web" (udm=14) is the only filter that keeps the All tab's organic results.
const WEB_ONLY_UDM = "14";

// Google's line on scholarly results: "by TF Smith · 1981 · Cited by 15512 —", "de A Vaswani · 2017 · Citado por …".
const BYLINE = /^\s*\p{Ll}+\s+([^·—]+?)\s*·\s*(1[5-9]\d\d|20\d\d)\s*·/u;
// Format tags Google prints before a title: "[PDF] ", "(PDF) ", "[HTML] ".
const TITLE_TAG = /^\s*[[(](?:PDF|HTML|DOC|PS)[\])]\s*/i;

/** True for a Google web search on the All tab (or the Web filter): images, news, video, books and AI mode are excluded. */
export function isGoogleSearchUrl(url: string | undefined): boolean {
  try {
    const u = new URL(url ?? "");
    if (u.protocol !== "https:" || !GOOGLE_HOST.test(u.hostname) || u.pathname !== "/search") return false;
    const udm = u.searchParams.get("udm");
    return !u.searchParams.has("tbm") && (udm === null || udm === WEB_ONLY_UDM);
  } catch {
    return false;
  }
}

/** Organic result blocks: positioned results inside the main column, never ads. */
export function googleResults(root: ParentNode): Element[] {
  const AD = "#tads, #bottomads, [data-text-ad]";
  return [...root.querySelectorAll("#rso [data-rpos]")].filter((el) => !el.closest(AD) && !el.querySelector(AD));
}

/** Splits Google's scholarly line into its first author and year; undefined on any other line (dates, "Cited by" alone). */
export function parseByline(text: string): { authors: string[]; year: number } | undefined {
  const m = BYLINE.exec(text.replace(/ /g, " "));
  if (!m) return undefined;
  const authors = m[1]!.split(",").map((a) => a.replace(/…|\.\.\.$/g, "").trim()).filter((a) => /\p{L}/u.test(a));
  return authors.length ? { authors, year: Number(m[2]) } : undefined;
}

/** Reads one result block; undefined for blocks without a title link (People also ask, AI overview, knowledge panels). */
export function readGoogleResult(el: Element): SearchHit | undefined {
  const heading = el.querySelector("a[href] > h3");
  const link = heading?.parentElement as HTMLAnchorElement | null | undefined;
  if (!heading || !link || !/^https?:/.test(link.href) || isGoogleUrl(link.href)) return undefined;
  const title = (heading.textContent ?? "").replace(/\s+/g, " ").replace(TITLE_TAG, "").trim();
  if (!title) return undefined;
  const hit: SearchHit = { key: link.href, title, url: link.href, authors: [] };
  const line = [...el.querySelectorAll("span")].map((s) => parseByline(s.textContent ?? "")).find(Boolean);
  if (line) {
    hit.authors = line.authors;
    hit.year = line.year;
  }
  return hit;
}

/**
 * Whether a result is a paper: its link is on a scholarly host or carries a DOI, arXiv id or PMID, or Google printed
 * its author and year line.
 */
export function isPaperHit(hit: SearchHit): boolean {
  if (!hit.url) return false;
  // TRAP: a snippet's DOI is no signal; on a DOI search Google highlights the DOI on every page that cites the paper.
  return isScholarlyHost(hit.url) || Object.keys(idsFromHit(hit)).length > 0 || (hit.authors.length > 0 && !!hit.year);
}

function isGoogleUrl(url: string): boolean {
  try {
    return GOOGLE_HOST.test(new URL(url).hostname);
  } catch {
    return false;
  }
}
