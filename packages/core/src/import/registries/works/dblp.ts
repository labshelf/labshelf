/** Searches DBLP for computer-science publications. */
import { asString, extractYear } from "../../metadata/index.js";
import { fetchJson, type RegistryEnv } from "../http.js";
import { asArray, firstNonEmpty } from "../text.js";
import type { RegistryRecord } from "../types.js";

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
export async function dblpSearch(env: RegistryEnv, query: string, rows = 3): Promise<RegistryRecord[]> {
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

function mapDblpInfo(info: DblpInfo): RegistryRecord {
  return {
    title: asString(info.title),
    authors: asArray(info.authors?.author)
      .map((author) => asString(author.text))
      .filter((name): name is string => Boolean(name)),
    year: extractYear(info.year),
    journal: firstNonEmpty(asArray(info.venue)),
    volume: asString(info.volume),
    pages: asString(info.pages),
    doi: asString(info.doi),
    url: firstNonEmpty(asArray(info.ee)) ?? asString(info.url),
  };
}
