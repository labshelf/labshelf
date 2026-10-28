// Reads search result pages into SearchHit records (Google Scholar and Google web results) and derives what a hit
// identifies: the DOI, arXiv id or PMID its links carry, and its library lookup item.
// The Google parser keys on the result link and its h3, never on Google's generated class names.
import {
  extractArxivIdentifierFromUrl, extractDoi, extractPmidFromUrl, isScholarlyHost, type DetectedIds,
} from "@labshelf/core";
import type { LibraryFindItem, SearchHit } from "../platform";

// ----- Google Scholar: result blocks (div.gs_r.gs_or)
// The green line "A Aggarwal, M Klawe… - Proceedings of the …, 1986 - dl.acm.org" splits into authors, venue, year.

// Google Scholar's own hosts: scholar.google.com and its country domains
// (.com.br, .co.uk, .de, …). The manifest glob "scholar.google.*" alone would
// also match scholar.google.<anything>.com.
const SCHOLAR_HOST = /^scholar\.google\.(?:com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/;

/**
 * True for a Google Scholar page URL.
 */
export function isScholarUrl(url: string | undefined): boolean {
  try {
    const u = new URL(url ?? "");
    return u.protocol === "https:" && SCHOLAR_HOST.test(u.hostname);
  } catch {
    return false;
  }
}

export interface AuthorsLine {
  authors: string[];
  venue?: string;
  year?: number;
  host?: string;
}

/**
 * Splits Scholar's byline: "authors - venue, year - source". The source (a
 * domain or a publisher name) is the last of three or more segments, or a
 * lone second segment that looks like a domain; authors may end in "…".
 */
export function parseAuthorsLine(text: string): AuthorsLine {
  const parts = text.replace(/\u00a0/g, " ").split(/\s+[-–]\s+/).map((p) => p.trim()).filter(Boolean);
  const out: AuthorsLine = { authors: [] };
  if (!parts.length) return out;

  const last = parts[parts.length - 1]!;
  if (parts.length > 2 || (parts.length === 2 && /^[\w.-]+\.[a-z]{2,}$/i.test(last))) {
    out.host = last;
    parts.pop();
  }
  out.authors = (parts.shift() ?? "")
    .split(",")
    .map((a) => a.replace(/…|\.\.\.$/g, "").trim())
    .filter((a) => a && /[a-z]/i.test(a));

  const middle = parts.join(" - ");
  const year = /\b(1[5-9]\d\d|20\d\d)\b(?!.*\b(1[5-9]\d\d|20\d\d)\b)/.exec(middle)?.[1];
  if (year) out.year = Number(year);
  const venue = middle.replace(/,?\s*\b(1[5-9]\d\d|20\d\d)\b\s*$/, "").replace(/[,\s]+$/, "").trim();
  if (venue && venue !== year) out.venue = venue;
  return out;
}

/**
 * Reads one result block; undefined for blocks that are not results
 * (author profiles, "related searches").
 */
export function readScholarHit(el: Element): SearchHit | undefined {
  const heading = el.querySelector("h3.gs_rt");
  if (!heading) return undefined;
  const titleNode = heading.cloneNode(true) as Element;
  titleNode.querySelectorAll(".gs_ctc, .gs_ctu, .gs_ctg, .gs_ctg2").forEach((n) => n.remove());
  const title = (titleNode.textContent ?? "").replace(/\s+/g, " ").trim();
  if (!title) return undefined;

  const link = heading.querySelector<HTMLAnchorElement>("a[href]");
  const pdfAnchor = [...el.querySelectorAll<HTMLAnchorElement>(".gs_or_ggsm a[href], .gs_ggsd a[href]")]
    .find((a) => /\[pdf\]/i.test(a.querySelector(".gs_ctg2")?.textContent ?? "") || /\.pdf(?:[?#]|$)/i.test(a.href));
  const line = parseAuthorsLine(el.querySelector(".gs_a")?.textContent ?? "");
  const key = (el as HTMLElement).dataset?.["cid"] || (el as HTMLElement).dataset?.["did"] || link?.id || title;

  const hit: SearchHit = { key, title, authors: line.authors };
  if (link?.href && /^https?:/.test(link.href)) hit.url = link.href;
  if (pdfAnchor?.href && /^https?:/.test(pdfAnchor.href)) hit.pdfUrl = pdfAnchor.href;
  if (line.venue) hit.venue = line.venue;
  if (line.year) hit.year = line.year;
  return hit;
}

// ----- Google web results

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
export function findGoogleHits(root: ParentNode): Element[] {
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
export function readGoogleHit(el: Element): SearchHit | undefined {
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
  return isScholarlyHost(hit.url) || Object.keys(extractIdentifiersFromHit(hit)).length > 0 || (hit.authors.length > 0 && !!hit.year);
}

function isGoogleUrl(url: string): boolean {
  try {
    return GOOGLE_HOST.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

// ----- Identifiers of a hit

/**
 * Identifiers a result's links reveal (publisher URLs embed the DOI).
 */
export function extractIdentifiersFromHit(hit: SearchHit): DetectedIds {
  const urls = [hit.url, hit.pdfUrl].filter((u): u is string => !!u);
  const doi = urls.map((u) => extractDoi(u)).find(Boolean);
  const arxivId = urls.map(extractArxivIdentifierFromUrl).find(Boolean);
  const pmid = urls.map(extractPmidFromUrl).find(Boolean);
  return { ...(doi ? { doi } : {}), ...(arxivId ? { arxivId } : {}), ...(pmid ? { pmid } : {}) };
}

/**
 * What the library lookup needs to recognise a result.
 */
export function createLibraryFindItem(hit: SearchHit): LibraryFindItem {
  const { doi, arxivId } = extractIdentifiersFromHit(hit);
  return {
    key: hit.key,
    title: hit.title,
    ...(hit.year ? { year: hit.year } : {}),
    ...(doi ? { doi } : {}),
    ...(arxivId ? { arxivId } : {}),
  };
}
