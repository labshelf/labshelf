/** Searches OpenAlex for works by free text, and suggests works for a title through its free autocomplete. */
import { asString } from "../../metadata/index.js";
import { fetchJson, type RegistryEnv } from "../http.js";
import type { RegistryRecord } from "../types.js";

interface OpenAlexWork {
  title?: string;
  display_name?: string;
  doi?: string;
  publication_year?: number;
  language?: string;
  authorships?: Array<{ author?: { display_name?: string } }>;
  primary_location?: {
    source?: { display_name?: string; issn_l?: string; host_organization_name?: string };
    landing_page_url?: string;
  };
  biblio?: { volume?: string; issue?: string; first_page?: string; last_page?: string };
}

/**
 * Searches OpenAlex, which indexes far more venues than CrossRef and tolerates
 * noisy titles well.
 * @returns Candidate works, best match first.
 */
export async function openAlexSearch(env: RegistryEnv, query: string, rows = 3): Promise<RegistryRecord[]> {
  const payload = await fetchJson<{ results?: OpenAlexWork[] }>(
    env,
    `https://api.openalex.org/works?per-page=${rows}&search=${encodeURIComponent(query)}`,
  );
  return (payload?.results ?? []).map(mapOpenAlexWork);
}

function mapOpenAlexWork(work: OpenAlexWork): RegistryRecord {
  const biblio = work.biblio;
  const pages =
    biblio?.first_page && biblio.last_page && biblio.first_page !== biblio.last_page
      ? `${biblio.first_page}-${biblio.last_page}`
      : biblio?.first_page;

  return {
    title: work.title ?? work.display_name,
    authors: (work.authorships ?? [])
      .map((authorship) => authorship.author?.display_name)
      .filter((name): name is string => Boolean(name)),
    year: work.publication_year,
    journal: work.primary_location?.source?.display_name,
    publisher: work.primary_location?.source?.host_organization_name,
    volume: asString(biblio?.volume),
    issue: asString(biblio?.issue),
    pages: asString(pages),
    // OpenAlex returns the DOI as a resolver URL.
    doi: work.doi?.replace(/^https?:\/\/(dx\.)?doi\.org\//i, ""),
    url: work.primary_location?.landing_page_url,
    issn: work.primary_location?.source?.issn_l,
    language: asString(work.language),
  };
}

/** A work OpenAlex suggests for a title: its id, title and the authors its hint names. */
export interface OpenAlexSuggestion {
  /** The short work id ("W2626778328"). */
  workId: string;
  title: string;
  authors: string[];
}

interface AutocompleteHit {
  id?: string;
  display_name?: string;
  /** The first authors, comma-separated, ending in "et al." when there are more. */
  hint?: string | null;
}

// TRAP: unlike `/works?search=`, `/autocomplete/works` is free, but its hits carry no year and its hint can be "Family, Given".
/**
 * Asks OpenAlex's autocomplete for the works whose title starts like `title`.
 * @returns Suggestions in OpenAlex's order; none when the call fails.
 */
export async function openAlexAutocomplete(env: RegistryEnv, title: string): Promise<OpenAlexSuggestion[]> {
  const payload = await fetchJson<{ results?: AutocompleteHit[] }>(
    env,
    `https://api.openalex.org/autocomplete/works?q=${encodeURIComponent(title)}`,
  );
  return (payload?.results ?? []).flatMap((hit) => {
    const workId = /W\d+$/.exec(hit.id ?? "")?.[0];
    return workId && hit.display_name
      ? [{ workId, title: hit.display_name, authors: (hit.hint ?? "").split(",").map((name) => name.trim()).filter((name) => name && !/^et al\.?$/i.test(name)) }]
      : [];
  });
}
