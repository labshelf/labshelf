/** Looks up CrossRef records by DOI and by fuzzy bibliographic search. */
import { fetchJson, type RegistryEnv } from "./http.js";
import { firstNonEmpty, xmlText } from "./text.js";
import { asString } from "../metadata/index.js";
import type { RegistryRecord } from "./registryMetadata.js";

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
export async function crossRefByDoi(env: RegistryEnv, doi: string): Promise<RegistryRecord | undefined> {
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
export async function crossRefSearch(env: RegistryEnv, query: string, rows = 3): Promise<RegistryRecord[]> {
  const payload = await fetchJson<{ message?: { items?: CrossRefWork[] } }>(
    env,
    `https://api.crossref.org/works?rows=${rows}&query.bibliographic=${encodeURIComponent(query)}`,
  );
  return (payload?.message?.items ?? []).map(mapCrossRefWork);
}

function mapCrossRefWork(work: CrossRefWork): RegistryRecord {
  return {
    title: firstNonEmpty(work.title),
    authors: (work.author ?? [])
      .map((author) => author.name ?? [author.given, author.family].filter(Boolean).join(" ").trim())
      .filter((name): name is string => Boolean(name)),
    year: work.issued?.["date-parts"]?.[0]?.[0],
    journal: firstNonEmpty(work["container-title"]) ?? firstNonEmpty(work["short-container-title"]),
    publisher: asString(work.publisher),
    volume: asString(work.volume),
    issue: asString(work.issue),
    pages: asString(work.page),
    doi: asString(work.DOI),
    url: asString(work.URL),
    issn: asString(work.ISSN?.[0]),
    language: asString(work.language),
    // CrossRef abstracts carry JATS XML markup.
    summary: work.abstract ? xmlText(work.abstract) : undefined,
    isComponent: work.type === "component",
  };
}
