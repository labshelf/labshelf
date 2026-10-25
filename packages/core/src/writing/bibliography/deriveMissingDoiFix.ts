/** Finds the DOI of an entry that lacks one and returns the edit that adds it. */
import { searchCrossref, type RegistryEnv } from "../../import/index.js";
import { normalizeTitleForMatch } from "../../library/index.js";
import { extractPlainField, type BibEntry } from "./parseBibEntries.js";
import type { BibliographyFix } from "./bibliographyReport.js";

/**
 * Asks CrossRef by title and authors; a candidate counts only with the same title key and, when both have one, the same year,
 * because a near title is often a different paper of the same group.
 * @returns the insertion after the entry's key, or undefined when no candidate matches
 */
export async function deriveMissingDoiFix(env: RegistryEnv, text: string, entry: BibEntry): Promise<BibliographyFix | undefined> {
  const title = extractPlainField(entry.fields.get("title"));
  if (!normalizeTitleForMatch(title)) { return undefined; }
  const year = Number.parseInt(extractPlainField(entry.fields.get("year")), 10);
  const query = `${title} ${extractPlainField(entry.fields.get("author"))}`;
  const match = (await searchCrossref(env, query)).find((record) =>
    !record.isComponent && record.doi && normalizeTitleForMatch(record.title ?? "") === normalizeTitleForMatch(title)
    && (!record.year || Number.isNaN(year) || record.year === year));
  if (!match?.doi) { return undefined; }
  // INVARIANT: the parser accepted the entry, so a comma follows its key.
  const afterKey = text.indexOf(",", entry.start) + 1;
  return { title: `Add doi:${match.doi}`, start: afterKey, end: afterKey, text: `\n  doi = {${match.doi}},` };
}
