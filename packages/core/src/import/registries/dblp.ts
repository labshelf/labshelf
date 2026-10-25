/** Searches DBLP for computer-science publications. */
import { parseString, extractYear } from "../metadata/index.js";
import { fetchJson, type RegistryEnv } from "./http.js";
import { normalizeArray, findFirstNonEmpty } from "./text.js";
import type { RegistryEntry } from "./registryMetadata.js";

interface DblpAuthor {
  text?: string;
}

interface DblpInfo {
  title?: string;
  // DBLP collapses single-element lists into the element itself, so any of
  // these repeatable fields arrives as either one value or an array.
  authors?: { author?: DblpAuthor | DblpAuthor[] };
  year?: string;
  venue?: string | string[];
  volume?: string;
  pages?: string;
  doi?: string;
  ee?: string | string[];
  url?: string;
}

interface DblpHit {
  info?: DblpInfo;
}

/**
 * Searches DBLP. Computer-science work is overwhelmingly published at
 * conferences, which CrossRef indexes patchily, so DBLP is the only reliable
 * source for a large part of the field.
 * @returns Up to `rows` candidate publications, best match first.
 */
export async function searchDblp(env: RegistryEnv, query: string, rows = 3): Promise<RegistryEntry[]> {
  const payload = await fetchJson<{ result?: { hits?: { hit?: DblpHit[] } } }>(
    env,
    `https://dblp.org/search/publ/api?format=json&h=${rows}&q=${encodeURIComponent(query)}`,
  );
  // DBLP drops `hit` entirely when the query matches nothing.
  return (payload?.result?.hits?.hit ?? [])
    .map((hit) => hit.info)
    .filter((info): info is DblpInfo => Boolean(info?.title))
    .map(mapDblpInfo);
}

function mapDblpInfo(info: DblpInfo): RegistryEntry {
  return {
    title: parseString(info.title),
    authors: normalizeArray(info.authors?.author)
      .map((author) => parseString(author.text))
      .filter((name): name is string => Boolean(name)),
    year: extractYear(info.year),
    journal: findFirstNonEmpty(normalizeArray(info.venue)),
    volume: parseString(info.volume),
    pages: parseString(info.pages),
    doi: parseString(info.doi),
    url: findFirstNonEmpty(normalizeArray(info.ee)) ?? parseString(info.url),
  };
}
