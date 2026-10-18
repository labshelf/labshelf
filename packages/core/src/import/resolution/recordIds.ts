/** Reads the identifiers a stored paper record reveals. */
import type { PaperRecord } from "../../model/index.js";
import { arxivIdFromDoi, arxivIdFromUrl, extractDoi, pmidFromUrl } from "../identifiers/index.js";
import type { DetectedIds } from "../identifiers/index.js";

/** @returns the record's DOI, the arXiv id named by an arXiv DOI or an arxiv.org URL, and a PMID in a PubMed URL */
export function idsFromRecord(r: Pick<PaperRecord, "doi" | "url">): DetectedIds {
  const doi = extractDoi(r.doi);
  const arxivId = arxivIdFromDoi(r.doi) ?? (r.url ? arxivIdFromUrl(r.url) : undefined);
  const pmid = r.url ? pmidFromUrl(r.url) : undefined;
  return {
    ...(doi ? { doi } : {}),
    ...(arxivId ? { arxivId } : {}),
    ...(pmid ? { pmid } : {}),
  };
}
