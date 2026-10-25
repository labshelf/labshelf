/** Reads the arXiv id or preprint DOI a .bib entry names, the way arXiv, Google Scholar and biblatex write them. */
import { arxivIdFromDoi, arxivIdFromUrl, extractDoi, normalizeArxivId, type PreprintIds } from "../../import/index.js";
import { plainField, type BibEntry } from "./bibEntries.js";

// arXiv's own DOIs and bioRxiv/medRxiv's name the preprint itself.
const PREPRINT_DOI = /^10\.(48550|1101)\//i;
// Google Scholar writes `journal = {arXiv preprint arXiv:1706.03762}`.
const ARXIV_IN_TEXT = /arxiv:\s*(\S+)/i;

/** The ids to look the published version up by, or undefined when the entry is not a preprint or already has a journal DOI. */
export function preprintIdsOf(entry: BibEntry): PreprintIds | undefined {
  const doi = extractDoi(plainField(entry.fields.get("doi")));
  if (doi && !PREPRINT_DOI.test(doi)) { return undefined; }
  const arxivId = arxivIdOf(entry) ?? arxivIdFromDoi(doi);
  return arxivId || doi ? { arxivId, doi } : undefined;
}

function arxivIdOf(entry: BibEntry): string | undefined {
  const field = (name: string): string => plainField(entry.fields.get(name));
  const eprint = normalizeArxivId(field("eprint"));
  // A bare new-style eprint is an arXiv id even without `archivePrefix`; other servers use other id shapes.
  if (eprint) { return eprint; }
  const url = arxivIdFromUrl(field("url"));
  if (url) { return url; }
  for (const name of ["journal", "note", "howpublished"]) {
    const typed = ARXIV_IN_TEXT.exec(field(name))?.[1];
    const id = typed ? normalizeArxivId(typed.replace(/[.,;]+$/, "")) : undefined;
    if (id) { return id; }
  }
  return undefined;
}
