// Reduces the DOI, arXiv and PMC ids named by URLs or a library paper to comparable keys.
import { arxivIdFromDoi, arxivIdFromUrl, extractDoi, normalizeArxivId, normalizePmcid, pmcidFromUrl } from "../identifiers/index.js";

/** What identifies a library paper beyond its title; `url` is the page it was saved from. */
export interface PaperIdFields {
  doi?: string | undefined;
  arxivId?: string | undefined;
  pmcid?: string | undefined;
  url?: string | undefined;
}

// Keys are "doi:…", "arxiv:…" or "pmc:…", lower-cased, versions dropped, so one Set compares all three kinds.
const doiKey = (doi: string | undefined): string[] => (doi ? [`doi:${doi.toLowerCase()}`] : []);
const arxivKey = (id: string | undefined): string[] => (id ? [`arxiv:${id.toLowerCase()}`] : []);
const pmcKey = (id: string | undefined): string[] => (id ? [`pmc:${id.toLowerCase()}`] : []);

/** The ids a PDF's address or its referring page names. */
export function idKeysFromUrls(urls: readonly (string | undefined)[]): Set<string> {
  const keys: string[] = [];
  for (const url of urls) {
    if (!url) continue;
    const doi = extractDoi(url);
    keys.push(...doiKey(doi), ...arxivKey(arxivIdFromUrl(url) ?? arxivIdFromDoi(doi)), ...pmcKey(pmcidFromUrl(url)));
  }
  return new Set(keys);
}

/** The ids a library paper carries: its own fields plus those readable from its DOI and saved-from URL. */
export function idKeysFromPaper(paper: PaperIdFields): Set<string> {
  const doi = paper.doi ? (extractDoi(paper.doi) ?? paper.doi) : undefined;
  const fromUrl = paper.url ? idKeysFromUrls([paper.url]) : new Set<string>();
  const arxiv = paper.arxivId ? normalizeArxivId(paper.arxivId) : undefined;
  return new Set([
    ...fromUrl,
    ...doiKey(doi),
    ...arxivKey(arxiv ?? arxivIdFromDoi(doi)),
    ...pmcKey(normalizePmcid(paper.pmcid)),
  ]);
}
