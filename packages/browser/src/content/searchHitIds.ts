// Derives what a search hit identifies: the DOI, arXiv id or PMID its links carry, and its library lookup item.
import { arxivIdFromUrl, extractDoi, pmidFromUrl, type DetectedIds } from "@labshelf/core";
import type { LookupItem, SearchHit } from "../platform";

/**
 * Identifiers a result's links reveal (publisher URLs embed the DOI).
 */
export function idsFromHit(hit: SearchHit): DetectedIds {
  const urls = [hit.url, hit.pdfUrl].filter((u): u is string => !!u);
  const doi = urls.map((u) => extractDoi(u)).find(Boolean);
  const arxivId = urls.map(arxivIdFromUrl).find(Boolean);
  const pmid = urls.map(pmidFromUrl).find(Boolean);
  return { ...(doi ? { doi } : {}), ...(arxivId ? { arxivId } : {}), ...(pmid ? { pmid } : {}) };
}

/**
 * What the library lookup needs to recognise a result.
 */
export function lookupItemFor(hit: SearchHit): LookupItem {
  const { doi, arxivId } = idsFromHit(hit);
  return {
    key: hit.key,
    title: hit.title,
    ...(hit.year ? { year: hit.year } : {}),
    ...(doi ? { doi } : {}),
    ...(arxivId ? { arxivId } : {}),
  };
}
