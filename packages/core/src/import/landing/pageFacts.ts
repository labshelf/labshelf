// Interprets a page's citation_* / Dublin Core / PRISM meta tags into paper facts and PDF links to try.
// Publishers emit these tags for Google Scholar, so they are present even when a registry lookup fails.
import { extractYear, type ResolvedMetadata } from "../metadata/index.js";
import { authorsOf, keywordsOf, pagesOf, squash } from "./citationFields.js";
import { identifiersOf } from "./pageIdentifiers.js";
import { pdfCandidatesOf } from "./pdfCandidates.js";
import type { PageFacts, RawPage } from "./rawPage.js";

const TITLE_KEYS = ["citation_title", "dc.title", "prism.title", "bepress_citation_title"];

/** @returns what the page states about its paper, and whether it is a scholarly work at all */
export function interpretPage(raw: RawPage): PageFacts {
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

  const authors = authorsOf(all("citation_author", "bepress_citation_author"), all("dc.creator", "dcterms.creator"), first("citation_authors"));
  if (authors.length) metadata.authors = authors;

  const year = extractYear(first("citation_publication_date", "citation_date", "citation_cover_date", "citation_online_date", "citation_year",
    "prism.publicationdate", "prism.coverdate", "dc.date", "dcterms.issued", "dc.date.issued", "article:published_time"));
  if (year) metadata.year = year;

  setIf(metadata, "journal", first("citation_journal_title", "citation_conference_title", "citation_inbook_title", "citation_book_title",
    "prism.publicationname", "bepress_citation_journal_title", "citation_series_title"));
  setIf(metadata, "publisher", first("citation_publisher", "dc.publisher", "dcterms.publisher", "bepress_citation_publisher"));
  setIf(metadata, "volume", first("citation_volume", "prism.volume", "bepress_citation_volume"));
  setIf(metadata, "issue", first("citation_issue", "prism.number", "prism.issueidentifier", "bepress_citation_issue"));
  setIf(metadata, "pages", pagesOf(first("citation_firstpage", "prism.startingpage", "bepress_citation_firstpage"),
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
