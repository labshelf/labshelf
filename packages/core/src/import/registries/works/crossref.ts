/** CrossRef client: DOI lookup and fuzzy bibliographic search. */
import { fetchJson } from "../http.js";
import { firstNonEmpty, stripHtml, trimmed } from "../text.js";
import type { RegistryRecord } from "../types.js";

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
export async function crossRefByDoi(doi: string): Promise<RegistryRecord | undefined> {
  const payload = await fetchJson<{ message?: CrossRefWork }>(
    `https://api.crossref.org/works/${encodeURIComponent(doi)}`,
  );
  return payload?.message ? mapCrossRefWork(payload.message) : undefined;
}

/**
 * Runs CrossRef's fuzzy bibliographic search over raw front-matter text.
 * This is the workhorse for PDFs that state no identifier at all.
 * @returns Up to `rows` candidate works, best match first.
 */
export async function crossRefSearch(query: string, rows = 3): Promise<RegistryRecord[]> {
  const payload = await fetchJson<{ message?: { items?: CrossRefWork[] } }>(
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
    publisher: trimmed(work.publisher),
    volume: trimmed(work.volume),
    issue: trimmed(work.issue),
    pages: trimmed(work.page),
    doi: trimmed(work.DOI),
    url: trimmed(work.URL),
    issn: trimmed(work.ISSN?.[0]),
    language: trimmed(work.language),
    // CrossRef abstracts carry JATS XML markup.
    summary: work.abstract ? stripHtml(work.abstract) : undefined,
    isComponent: work.type === "component",
  };
}
