/** Europe PMC client: free-text article search. */
import { extractYear } from "../../metadata/index.js";
import { fetchJson } from "../http.js";
import { trimmed } from "../text.js";
import type { RegistryRecord } from "../types.js";

interface EuropePmcResult {
  id?: string;
  source?: string;
  title?: string;
  authorString?: string;
  pubYear?: string;
  journalTitle?: string;
  journalVolume?: string;
  issue?: string;
  pageInfo?: string;
  doi?: string;
  journalIssn?: string;
}

/**
 * Searches Europe PMC, which covers preprint servers and European journals that
 * PubMed omits, and accepts free-text queries.
 * @returns Up to `rows` candidate articles, best match first.
 */
export async function europePmcSearch(query: string, rows = 3): Promise<RegistryRecord[]> {
  const payload = await fetchJson<{ resultList?: { result?: EuropePmcResult[] } }>(
    `https://www.ebi.ac.uk/europepmc/webservices/rest/search?format=json&pageSize=${rows}&query=${encodeURIComponent(query)}`,
  );
  return (payload?.resultList?.result ?? []).map(mapEuropePmcResult);
}

function mapEuropePmcResult(result: EuropePmcResult): RegistryRecord {
  // Europe PMC's default `lite` result set carries no abstract, so summaries
  // have to come from another source.
  return {
    title: trimmed(result.title),
    // `authorString` is a display sentence: "Doe J, Roe R." — the final stop is
    // punctuation, not part of the last author's initials.
    authors: (trimmed(result.authorString)?.replace(/\.$/, "") ?? "")
      .split(", ")
      .map((name) => name.trim())
      .filter((name) => name.length > 0),
    year: extractYear(result.pubYear),
    journal: trimmed(result.journalTitle),
    volume: trimmed(result.journalVolume),
    issue: trimmed(result.issue),
    pages: trimmed(result.pageInfo),
    doi: trimmed(result.doi),
    issn: trimmed(result.journalIssn),
    url:
      result.source && result.id
        ? `https://europepmc.org/article/${encodeURIComponent(result.source)}/${encodeURIComponent(result.id)}`
        : undefined,
  };
}
