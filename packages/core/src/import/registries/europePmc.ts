/** Searches Europe PMC for articles by free text. */
import { asString, extractYear } from "../metadata/index.js";
import { fetchJson, type RegistryEnv } from "./http.js";
import type { RegistryRecord } from "./registryMetadata.js";

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
export async function europePmcSearch(env: RegistryEnv, query: string, rows = 3): Promise<RegistryRecord[]> {
  const payload = await fetchJson<{ resultList?: { result?: EuropePmcResult[] } }>(
    env,
    `https://www.ebi.ac.uk/europepmc/webservices/rest/search?format=json&pageSize=${rows}&query=${encodeURIComponent(query)}`,
  );
  return (payload?.resultList?.result ?? []).map(mapEuropePmcResult);
}

function mapEuropePmcResult(result: EuropePmcResult): RegistryRecord {
  // Europe PMC's default `lite` result set carries no abstract, so summaries
  // have to come from another source.
  return {
    title: asString(result.title),
    // `authorString` is a display sentence: "Doe J, Roe R." — the final stop is
    // punctuation, not part of the last author's initials.
    authors: (asString(result.authorString)?.replace(/\.$/, "") ?? "")
      .split(", ")
      .map((name) => name.trim())
      .filter((name) => name.length > 0),
    year: extractYear(result.pubYear),
    journal: asString(result.journalTitle),
    volume: asString(result.journalVolume),
    issue: asString(result.issue),
    pages: asString(result.pageInfo),
    doi: asString(result.doi),
    issn: asString(result.journalIssn),
    url:
      result.source && result.id
        ? `https://europepmc.org/article/${encodeURIComponent(result.source)}/${encodeURIComponent(result.id)}`
        : undefined,
  };
}
