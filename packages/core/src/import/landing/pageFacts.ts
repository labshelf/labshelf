// Interprets a page's citation_* / Dublin Core / PRISM meta tags into paper facts and PDF links to try.
// Publishers emit these tags for Google Scholar, so they are present even when a registry lookup fails.
import { hostOf } from "../../url/index.js";
import { extractYear, type ResolvedMetadata } from "../registries/index.js";
import type { PageFacts, RawPage, PdfCandidate } from "./rawPage.js";
import {
  extractArxivIdentifierFromDoi,
  extractArxivIdentifierFromUrl,
  extractDoi,
  normalizeArxivIdentifier,
  extractPmidFromUrl,
  type DetectedIds,
} from "../identifiers/index.js";

// Links whose URL says they are not the article itself.
const NOT_THE_ARTICLE = /supp|suppl|supplement|appendix|figure|poster|slides|review_history|license|terms|guide|instruction|author-?info|policy|catalog|brochure/i;
const MAX_ANCHOR_CANDIDATES = 4;

function pdfCandidatesOf(raw: RawPage, metaPdfUrls: string[], ids: DetectedIds): PdfCandidate[] {
  const out: PdfCandidate[] = [];
  const seen = new Set<string>();
  const add = (url: string | undefined): void => {
    if (!url) return;
    let abs: string;
    try { abs = new URL(url, raw.pageUrl).href; } catch { return; }
    if (!/^https?:/.test(abs) || seen.has(abs)) return;
    seen.add(abs);
    out.push({ url: abs, source: "page" });
  };

  if (raw.pageIsPdf) add(raw.pageUrl);
  raw.pdfLinks.filter((l) => l.kind === "embed").forEach((l) => add(l.url));
  metaPdfUrls.forEach(add);
  raw.pdfLinks.filter((l) => l.kind === "alternate").forEach((l) => add(l.url));

  // Plain anchors are a weaker signal: keep the ones that name this paper or sit
  // on the publisher's own host, never ones that are plainly something else.
  const host = hostOf(raw.pageUrl);
  const own = [ids.doi, ids.arxivId].filter((x): x is string => !!x).map((x) => x.toLowerCase());
  raw.pdfLinks
    .filter((l) => l.kind === "labelled" || l.kind === "href")
    .filter((l) => !NOT_THE_ARTICLE.test(l.url))
    .filter((l) => own.some((id) => safeDecode(l.url).toLowerCase().includes(id)) || hostOf(l.url) === host)
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "labelled" ? -1 : 1))
    .slice(0, MAX_ANCHOR_CANDIDATES)
    .forEach((l) => add(l.url));
  return out;
}

function safeDecode(url: string): string {
  try { return decodeURIComponent(url); } catch { return url; }
}

const DOI_META_KEYS = ["citation_doi", "dc.identifier.doi", "prism.doi", "bepress_citation_doi", "doi", "dc.identifier", "dcterms.identifier", "og:doi"];

/** @param first returns the first non-blank value among the given meta keys */
function identifiersOf(raw: RawPage, first: (...keys: string[]) => string | undefined): DetectedIds {
  const ids: DetectedIds = {};
  // dc.identifier may hold an ISBN or a URL, so take the first value that is a DOI.
  const metaDoi = DOI_META_KEYS
    .flatMap((key) => raw.meta[key] ?? [])
    .map((value) => extractDoi(value))
    .find((d) => !!d);
  // A page cites many DOIs in its references; a lone doi.org link is its own.
  const linkDois = [...new Set(raw.doiLinks.flatMap((l) => extractDoi(l)?.toLowerCase() ?? []))];
  const doi = metaDoi ?? extractDoi(raw.pageUrl) ?? (linkDois.length === 1 ? extractDoi(raw.doiLinks[0]) : undefined);
  if (doi) ids.doi = doi;
  const metaArxiv = first("citation_arxiv_id");
  const arxivId = (metaArxiv && normalizeArxivIdentifier(metaArxiv)) ?? extractArxivIdentifierFromUrl(raw.pageUrl) ?? extractArxivIdentifierFromDoi(doi);
  if (arxivId) ids.arxivId = arxivId;
  const pmid = first("citation_pmid") ?? extractPmidFromUrl(raw.pageUrl);
  if (pmid && /^\d{6,9}$/.test(pmid)) ids.pmid = pmid;
  return ids;
}

function squash(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Normalises authors to "Given Family", whichever form the page used. */
export function mergeAuthors(citationAuthors: string[], dcCreators: string[], joined?: string): string[] {
  let list = citationAuthors.length ? citationAuthors : dcCreators;
  if (!list.length && joined) list = joined.split(/\s*;\s*/);
  const out: string[] = [];
  for (const raw of list) {
    const name = squash(raw);
    if (!name) continue;
    const comma = /^([^,]+),\s*(.+)$/.exec(name);
    const flipped = comma ? `${comma[2]} ${comma[1]}` : name;
    if (!out.includes(flipped)) out.push(flipped);
  }
  return out;
}

/** "45" + "56" → "45-56"; a single page stays as is. */
export function derivePageRange(first: string | undefined, last: string | undefined): string | undefined {
  if (!first) return undefined;
  return last && last !== first ? `${first}-${last}` : first;
}

function keywordsOf(values: string[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    for (const k of v.split(/\s*[;,]\s*/)) {
      const kw = squash(k);
      if (kw && kw.length <= 80 && !out.some((x) => x.toLowerCase() === kw.toLowerCase())) out.push(kw);
    }
  }
  return out.slice(0, 20);
}

const TITLE_KEYS = ["citation_title", "dc.title", "prism.title", "bepress_citation_title"];

/** @returns what the page states about its paper, and whether it is a scholarly work at all */
export function derivePageFacts(raw: RawPage): PageFacts {
  const first = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      const value = raw.meta[key]?.find((v) => v.trim());
      if (value) return value.trim();
    }
    return undefined;
  };
  const all = (...keys: string[]): string[] => keys.flatMap((key) => raw.meta[key] ?? []).map((v) => v.trim()).filter(Boolean);

  const ids = identifiersOf(raw, first);
  const structured = !!first(...TITLE_KEYS);
  const metadata = metadataOf(raw, first, all, ids.doi, ids.arxivId);
  if (ids.doi) metadata.doi = ids.doi;

  const pdfCandidates = pdfCandidatesOf(raw, all("citation_pdf_url", "bepress_citation_pdf_url", "eprints.document_url"), ids);
  const isPaper = !!(ids.doi || ids.arxivId || ids.pmid || structured || raw.pageIsPdf ||
    raw.pdfLinks.some((l) => l.kind === "embed"));

  return { pageUrl: raw.pageUrl, ids, metadata, structured, pdfCandidates, isPaper };
}

function metadataOf(
  raw: RawPage,
  first: (...keys: string[]) => string | undefined,
  all: (...keys: string[]) => string[],
  doi: string | undefined,
  arxivId: string | undefined,
): ResolvedMetadata {
  const metadata: ResolvedMetadata = {};
  const title = first(...TITLE_KEYS) ??
    (doi || arxivId ? first("og:title", "twitter:title") : undefined) ??
    raw.documentTitle;
  if (title) metadata.title = squash(title);

  const authors = mergeAuthors(all("citation_author", "bepress_citation_author"), all("dc.creator", "dcterms.creator"), first("citation_authors"));
  if (authors.length) metadata.authors = authors;

  const year = extractYear(first("citation_publication_date", "citation_date", "citation_cover_date", "citation_online_date", "citation_year",
    "prism.publicationdate", "prism.coverdate", "dc.date", "dcterms.issued", "dc.date.issued", "article:published_time"));
  if (year) metadata.year = year;

  setIf(metadata, "journal", first("citation_journal_title", "citation_conference_title", "citation_inbook_title", "citation_book_title",
    "prism.publicationname", "bepress_citation_journal_title", "citation_series_title"));
  setIf(metadata, "publisher", first("citation_publisher", "dc.publisher", "dcterms.publisher", "bepress_citation_publisher"));
  setIf(metadata, "volume", first("citation_volume", "prism.volume", "bepress_citation_volume"));
  setIf(metadata, "issue", first("citation_issue", "prism.number", "prism.issueidentifier", "bepress_citation_issue"));
  setIf(metadata, "pages", derivePageRange(first("citation_firstpage", "prism.startingpage", "bepress_citation_firstpage"),
    first("citation_lastpage", "prism.endingpage", "bepress_citation_lastpage")));
  setIf(metadata, "issn", first("citation_issn", "prism.issn", "citation_eissn", "prism.eissn"));
  setIf(metadata, "language", first("citation_language", "dc.language", "dcterms.language"));
  setIf(metadata, "summary", first("citation_abstract", "dc.description.abstract", "dcterms.abstract", "dc.description"));
  const landing = first("citation_abstract_html_url", "citation_fulltext_html_url", "og:url");
  if (raw.pageIsPdf) setIf(metadata, "url", landing);
  else setIf(metadata, "url", landing ?? raw.pageUrl);
  const keywords = keywordsOf(all("citation_keywords", "dc.subject", "keywords"));
  if (keywords.length) metadata.keywords = keywords;
  return metadata;
}

function setIf<K extends keyof ResolvedMetadata>(target: ResolvedMetadata, key: K, value: string | undefined): void {
  const v = value ? squash(value) : "";
  if (v) (target as Record<string, unknown>)[key] = v;
}
