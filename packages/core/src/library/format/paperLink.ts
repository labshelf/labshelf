/** The link a paper opens: its DOI resolver address, else its stored URL. */
import type { PaperRecord } from "../../model/index.js";

const DOI_RESOLVER_PREFIX = /^https?:\/\/(?:dx\.)?doi\.org\//i;

/** @returns https://doi.org/<doi> (a DOI stored as a full resolver URL is not prefixed twice), else the URL, else undefined. */
export function paperLink(paper: Pick<PaperRecord, "doi" | "url">): string | undefined {
  const doi = paper.doi?.trim().replace(DOI_RESOLVER_PREFIX, "");
  if (doi) { return `https://doi.org/${doi}`; }
  return paper.url || undefined;
}
