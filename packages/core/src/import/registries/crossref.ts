/** Looks up CrossRef records by DOI and by fuzzy bibliographic search. */
import { fetchJson, type RegistryEnv } from "./http.js";
import { findFirstNonEmpty, parseXmlText } from "./text.js";
import { parseString } from "../metadata/index.js";
import type { RegistryEntry } from "./registryMetadata.js";

interface CrossRefWork {
  type?: string;
  title?: string[];
  author?: Array<{ given?: string; family?: string; name?: string }>;
  issued?: { "date-parts"?: number[][] };
  "container-title"?: string[];
  "short-container-title"?: string[];
  publisher?: string;
  volume?: string;
  issue?: string;
  page?: string;
  DOI?: string;
  URL?: string;
  ISSN?: string[];
  language?: string;
  abstract?: string;
}

/**
 * Looks up a DOI in CrossRef.
 * @returns The work's metadata, or undefined when the DOI is unknown.
 */
export async function fetchCrossrefByDoi(env: RegistryEnv, doi: string): Promise<RegistryEntry | undefined> {
  const payload = await fetchJson<{ message?: CrossRefWork }>(
    env,
    `https://api.crossref.org/works/${encodeURIComponent(doi)}`,
  );
  return payload?.message ? mapCrossRefWork(payload.message) : undefined;
}

/**
 * Runs CrossRef's fuzzy bibliographic search over raw front-matter text.
 * This is the workhorse for PDFs that state no identifier at all.
 * @returns Up to `rows` candidate works, best match first.
 */
export async function searchCrossref(env: RegistryEnv, query: string, rows = 3): Promise<RegistryEntry[]> {
  const payload = await fetchJson<{ message?: { items?: CrossRefWork[] } }>(
    env,
    `https://api.crossref.org/works?rows=${rows}&query.bibliographic=${encodeURIComponent(query)}`,
  );
  return (payload?.message?.items ?? []).map(mapCrossRefWork);
}

function mapCrossRefWork(work: CrossRefWork): RegistryEntry {
  return {
    title: findFirstNonEmpty(work.title),
    authors: (work.author ?? [])
      .map((author) => author.name ?? [author.given, author.family].filter(Boolean).join(" ").trim())
      .filter((name): name is string => Boolean(name)),
    year: work.issued?.["date-parts"]?.[0]?.[0],
    journal: findFirstNonEmpty(work["container-title"]) ?? findFirstNonEmpty(work["short-container-title"]),
    publisher: parseString(work.publisher),
    volume: parseString(work.volume),
    issue: parseString(work.issue),
    pages: parseString(work.page),
    doi: parseString(work.DOI),
    url: parseString(work.URL),
    issn: parseString(work.ISSN?.[0]),
    language: parseString(work.language),
    // CrossRef abstracts carry JATS XML markup.
    summary: work.abstract ? parseXmlText(work.abstract) : undefined,
    isComponent: work.type === "component",
  };
}
