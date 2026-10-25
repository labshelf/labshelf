/** Finds the DOI of the journal version of a preprint, from arXiv's author-reported DOI or CrossRef's preprint relation. */
import { fetchJson, type RegistryEnv } from "./http.js";
import { fetchArxivByIdentifier } from "./arxiv.js";

// arXiv's own DOIs (10.48550) and bioRxiv/medRxiv's (10.1101) name the preprint itself, never the journal version.
const PREPRINT_DOI = /^10\.(48550|1101)\//i;

interface CrossRefRelations {
  message?: { relation?: { "is-preprint-of"?: Array<{ "id-type"?: string; id?: string }> } };
}

/** What identifies the preprint: its arXiv id, its DOI, or both. */
export interface PreprintIds {
  arxivId?: string | undefined;
  doi?: string | undefined;
}

/**
 * Asks arXiv first (free, and the authors fill it in), then CrossRef for a preprint DOI.
 * @returns the published version's DOI, or undefined when none is recorded
 */
export async function findPublishedDoi(env: RegistryEnv, preprint: PreprintIds): Promise<string | undefined> {
  if (preprint.arxivId) {
    const fromArxiv = (await fetchArxivByIdentifier(env, preprint.arxivId))?.doi;
    if (isJournalDoi(fromArxiv)) return fromArxiv;
  }
  if (!preprint.doi || !PREPRINT_DOI.test(preprint.doi)) return undefined;
  const work = await fetchJson<CrossRefRelations>(env, `https://api.crossref.org/works/${encodeURIComponent(preprint.doi)}`);
  const related = work?.message?.relation?.["is-preprint-of"]?.find((r) => r["id-type"] === "doi")?.id;
  return isJournalDoi(related) ? related : undefined;
}

function isJournalDoi(doi: string | undefined): doi is string {
  return Boolean(doi) && !PREPRINT_DOI.test(doi!);
}
