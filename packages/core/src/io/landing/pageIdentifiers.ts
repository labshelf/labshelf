/** The DOI, arXiv id and PMID a page states in its meta tags, links and URL. */
import { arxivIdFromDoi, arxivIdFromUrl, extractDoi, pmidFromUrl } from "../identifiers/index.js";
import type { DetectedIds } from "../identifiers/index.js";
import type { RawPage } from "./types.js";

const DOI_META_KEYS = ["citation_doi", "dc.identifier.doi", "prism.doi", "bepress_citation_doi", "doi", "dc.identifier", "dcterms.identifier", "og:doi"];

/** @param first returns the first non-blank value among the given meta keys */
export function identifiersOf(raw: RawPage, first: (...keys: string[]) => string | undefined): DetectedIds {
  const ids: DetectedIds = {};
  // dc.identifier may hold an ISBN or a URL, so take the first value that is a DOI.
  const metaDoi = DOI_META_KEYS
    .flatMap((key) => raw.meta[key] ?? [])
    .map((value) => extractDoi(value))
    .find((d): d is string => !!d);
  // A page cites many DOIs in its references; a lone doi.org link is its own.
  const linkDois = [...new Set(raw.doiLinks.map((l) => extractDoi(l)).filter((d): d is string => !!d).map((d) => d.toLowerCase()))];
  const doi = metaDoi ?? extractDoi(raw.pageUrl) ?? (linkDois.length === 1 ? extractDoi(raw.doiLinks[0]) : undefined);
  if (doi) ids.doi = doi;
  const arxivId = first("citation_arxiv_id") ?? arxivIdFromUrl(raw.pageUrl) ?? arxivIdFromDoi(doi);
  if (arxivId) ids.arxivId = arxivId.replace(/^arxiv:/i, "").replace(/v\d+$/, "");
  const pmid = first("citation_pmid") ?? pmidFromUrl(raw.pageUrl);
  if (pmid && /^\d{6,9}$/.test(pmid)) ids.pmid = pmid;
  return ids;
}
