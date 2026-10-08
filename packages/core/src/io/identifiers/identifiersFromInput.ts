/** Recognises the identifiers in what a user typed or pasted: bare ids, labelled DOIs and publisher links. */
import { arxivIdFromUrl, normalizeArxivId } from "./arxiv.js";
import { detectIdentifiers } from "./detectIdentifiers.js";
import { extractDoi } from "./doi.js";
import { pmidFromUrl } from "./pubmed.js";
import type { DetectedIdentifier } from "./types.js";

// A DOI the user typed on its own, with an optional `doi:` label or doi.org link.
const TYPED_DOI = /^(?:doi:\s*|https?:\/\/(?:dx\.)?doi\.org\/)?10\./i;

/**
 * Finds the identifiers in typed or pasted input. Whole-input forms (a bare
 * arXiv id, a DOI, an arXiv or PubMed link) are read exactly; anything else is
 * scanned like PDF text, with the input also counting as a link target.
 * @returns The identifiers found, best first.
 */
export function identifiersFromInput(input: string): DetectedIdentifier[] {
  const text = input.trim();
  const arxiv = normalizeArxivId(text) ?? arxivIdFromUrl(text);
  if (arxiv) {
    return [{ type: "arxiv", value: arxiv }];
  }
  const pmid = pmidFromUrl(text);
  if (pmid) {
    return [{ type: "pmid", value: pmid }];
  }
  const doi = TYPED_DOI.test(text) ? extractDoi(text) : undefined;
  if (doi) {
    return [{ type: "doi", value: doi }];
  }
  return detectIdentifiers({}, text, [text]);
}
