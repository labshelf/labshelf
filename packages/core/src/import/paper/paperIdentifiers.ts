/** Reads the identifiers a stored paper record reveals. */
import type { PaperRecord } from "../../model/index.js";
import { extractArxivIdentifierFromDoi, extractArxivIdentifierFromUrl, extractDoi, extractPmidFromUrl } from "../identifiers/index.js";
import type { DetectedIds } from "../identifiers/index.js";

/** @returns the record's DOI, the arXiv id named by an arXiv DOI or an arxiv.org URL, and a PMID in a PubMed URL */
export function extractPaperIdentifiers(r: Pick<PaperRecord, "doi" | "url">): DetectedIds {
  const doi = extractDoi(r.doi);
  const arxivId = extractArxivIdentifierFromDoi(r.doi) ?? (r.url ? extractArxivIdentifierFromUrl(r.url) : undefined);
  const pmid = r.url ? extractPmidFromUrl(r.url) : undefined;
  return {
    ...(doi ? { doi } : {}),
    ...(arxivId ? { arxivId } : {}),
    ...(pmid ? { pmid } : {}),
  };
}
