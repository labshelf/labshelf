/** Searches OpenAlex for works by free text. */
import { fetchJson } from "../http.js";
import { trimmed } from "../text.js";
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
export async function openAlexSearch(query: string, rows = 3): Promise<RegistryRecord[]> {
  const payload = await fetchJson<{ results?: OpenAlexWork[] }>(
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
    volume: trimmed(biblio?.volume),
    issue: trimmed(biblio?.issue),
    pages: trimmed(pages),
    // OpenAlex returns the DOI as a resolver URL.
    doi: work.doi?.replace(/^https?:\/\/(dx\.)?doi\.org\//i, ""),
    url: work.primary_location?.landing_page_url,
    issn: work.primary_location?.source?.issn_l,
    language: trimmed(work.language),
  };
}
