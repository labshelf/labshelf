/** Merges one member's generated labshelf.bib into the shared one without removing what other members' libraries added. */
// CONTRACT: documents/contracts/library-format.md#labshelfbib

import { arxivIdFromDoi, arxivIdFromUrl, extractDoi, normalizeArxivId } from "../../import/index.js";
import { bibEntries, plainField, type BibEntry } from "../../writing/bibliography/index.js";

/** A cite key both files use for different works; the shared entry is kept. Ids read `doi:<doi>` or `arXiv:<id>`. */
export interface BibliographyClash {
  key: string;
  sharedId: string;
  localId: string | undefined;
}

export interface MergedBibliography {
  text: string;
  clashes: BibliographyClash[];
}

interface WorkIds { doi: string | undefined; arxiv: string | undefined }

function workIds(entry: BibEntry): WorkIds {
  const doi = extractDoi(plainField(entry.fields.get("doi")))?.toLowerCase();
  const arxiv = normalizeArxivId(plainField(entry.fields.get("eprint")))
    ?? arxivIdFromDoi(doi) ?? arxivIdFromUrl(plainField(entry.fields.get("url")));
  return { doi, arxiv: arxiv?.toLowerCase() };
}

const ARXIV_DOI = /^10\.48550\/arxiv\./i;

const idLabel = ({ doi, arxiv }: WorkIds): string | undefined =>
  doi ? `doi:${doi}` : arxiv ? `arXiv:${arxiv}` : undefined;

/**
 * Two entries under one key are the same work when their DOIs match, else when their arXiv ids match (from `eprint`,
 * an arXiv DOI or an arxiv.org url), else when the shared entry names neither, since nothing then says otherwise.
 */
function sameWork(shared: WorkIds, local: WorkIds): boolean {
  // An arXiv DOI names the preprint, so a published DOI beside it does not make another work.
  const publishedDoi = (doi: string | undefined) => (doi && !ARXIV_DOI.test(doi) ? doi : undefined);
  if (publishedDoi(shared.doi) && publishedDoi(local.doi)) { return shared.doi === local.doi; }
  if (shared.doi && shared.doi === local.doi) { return true; }
  if (shared.arxiv && shared.arxiv === local.arxiv) { return true; }
  return !shared.doi && !shared.arxiv;
}

/**
 * Adds the generated entries the shared file lacks and updates those of the same work; never removes an entry.
 * Text outside the replaced entries, comments and @string blocks included, stays byte for byte.
 */
export function mergeGeneratedBibliography(sharedText: string, generatedText: string): MergedBibliography {
  if (sharedText.trim() === "") { return { text: generatedText, clashes: [] }; }
  const shared = new Map<string, BibEntry>();
  for (const entry of bibEntries(sharedText)) { if (!shared.has(entry.key)) { shared.set(entry.key, entry); } }
  const replacements: { entry: BibEntry; text: string }[] = [];
  const added: string[] = [];
  const clashes: BibliographyClash[] = [];
  for (const local of bibEntries(generatedText)) {
    const localText = generatedText.slice(local.start, local.end);
    const current = shared.get(local.key);
    if (!current) { added.push(localText); continue; }
    const sharedIds = workIds(current);
    const localIds = workIds(local);
    if (!sameWork(sharedIds, localIds)) {
      clashes.push({ key: local.key, sharedId: idLabel(sharedIds)!, localId: idLabel(localIds) });
    } else if (sharedText.slice(current.start, current.end) !== localText) {
      replacements.push({ entry: current, text: localText });
    }
  }
  let text = sharedText;
  for (const { entry, text: replacement } of replacements.sort((a, b) => b.entry.start - a.entry.start)) {
    text = text.slice(0, entry.start) + replacement + text.slice(entry.end);
  }
  if (added.length > 0) { text = `${text.trimEnd()}\n\n${added.join("\n\n")}\n`; }
  return { text, clashes };
}
