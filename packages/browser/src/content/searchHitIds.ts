// Derives what a search hit identifies: the DOI, arXiv id or PMID its links carry, and its library lookup item.
import { extractArxivIdentifierFromUrl, extractDoi, extractPmidFromUrl, type DetectedIds } from "@labshelf/core";
import type { LibraryFindItem, SearchHit } from "../platform";

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
