/** Searches OpenAlex for works by free text, suggests works for a title, and fetches one work with the works it cites. */
import { parseString } from "../../guards/index.js";
import { fetchJson, type RegistryEntry, type RegistryEnv } from "./http.js";

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
export async function openAlexSearch(env: RegistryEnv, query: string, rows = 3): Promise<RegistryEntry[]> {
  const payload = await fetchJson<{ results?: OpenAlexWork[] }>(
    env,
    `https://api.openalex.org/works?per-page=${rows}&search=${encodeURIComponent(query)}`,
  );
  return (payload?.results ?? []).map(mapOpenAlexWork);
}

function mapOpenAlexWork(work: OpenAlexWork): RegistryEntry {
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
    volume: parseString(biblio?.volume),
    issue: parseString(biblio?.issue),
    pages: parseString(pages),
    // OpenAlex returns the DOI as a resolver URL.
    doi: work.doi?.replace(/^https?:\/\/(dx\.)?doi\.org\//i, ""),
    url: work.primary_location?.landing_page_url,
    issn: work.primary_location?.source?.issn_l,
    language: parseString(work.language),
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

/** A work as the citation map needs it: identity, a display line, and the works it cites. */
export interface OpenAlexCitationWork {
  /** The short work id ("W2626778328"). */
  workId: string;
  doi?: string | undefined;
  title?: string | undefined;
  authors: string[];
  year?: number | undefined;
  citedByCount: number;
  /** Short ids of the works this one cites. */
  references: string[];
}

interface OpenAlexCitationPayload extends OpenAlexWork {
  id?: string;
  cited_by_count?: number;
  referenced_works?: string[];
}

const CITATION_FIELDS = "id,doi,title,display_name,publication_year,authorships,cited_by_count,referenced_works";

// TRAP: OpenAlex bills list and filter requests against a small keyless daily budget shared per IP, while single-work
// lookups cost nothing — so the citation map fetches work by work and never through `/works?filter=`.
/**
 * Fetches one work by DOI (`{ doi }`) or by short OpenAlex id (`{ workId }`).
 * @returns The work; undefined when OpenAlex does not know it or the call fails.
 */
export async function openAlexWork(env: RegistryEnv, id: { doi: string } | { workId: string }): Promise<OpenAlexCitationWork | undefined> {
  const path = "doi" in id ? `doi:${encodeURIComponent(id.doi).replace(/%2F/gi, "/")}` : encodeURIComponent(id.workId);
  const work = await fetchJson<OpenAlexCitationPayload>(env, `https://api.openalex.org/works/${path}?select=${CITATION_FIELDS}`);
  const workId = shortWorkId(work?.id);
  if (!work || !workId) {
    return undefined;
  }
  const record = mapOpenAlexWork(work);
  return {
    workId,
    doi: record.doi,
    title: record.title,
    authors: record.authors ?? [],
    year: record.year,
    citedByCount: work.cited_by_count ?? 0,
    references: (work.referenced_works ?? []).flatMap((ref) => shortWorkId(ref) ?? []),
  };
}

function shortWorkId(id: string | undefined): string | undefined {
  return /W\d+$/.exec(id ?? "")?.[0];
}
