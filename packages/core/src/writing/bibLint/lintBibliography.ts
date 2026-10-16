/** Lints the text of a user's .bib file: duplicates, missing DOIs and preprints with a published version. */
import { BIBLIOGRAPHY_HEADER } from "../citations/index.js";
import { bibEntries } from "./bibEntries.js";
import type { BibFinding } from "./bibLintTypes.js";
import { duplicateFindings, missingDoiFindings } from "./localRules.js";
import { publishedVersionFindings, type PublishedVersionLookup } from "./publishedVersionRule.js";

/** Findings in file order; LabShelf's generated labshelf.bib gets none, because the library rewrites it on every change. */
export async function lintBibliography(text: string, lookup: PublishedVersionLookup): Promise<BibFinding[]> {
  if (text.startsWith(BIBLIOGRAPHY_HEADER)) { return []; }
  const entries = bibEntries(text);
  const findings = [
    ...duplicateFindings(text, entries),
    ...missingDoiFindings(entries),
    ...await publishedVersionFindings(entries, lookup),
  ];
  return findings.sort((a, b) => a.start - b.start);
}
