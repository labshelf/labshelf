/** Looks up DOI registries (CrossRef, DataCite, Semantic Scholar) and finds the journal DOI of a preprint. */
import { encodeDoiPathSegment, toDoi, type Doi } from "../identifiers/index.js";
import { parseString } from "./metadata.js";
import { fetchJson, findFirstNonEmpty, parseXmlText, type RegistryEntry, type RegistryEnv } from "./http.js";
import { fetchArxivByIdentifier } from "./bibliographic.js";

// CrossRef

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

// DataCite

interface DataCiteAttributes {
  doi?: string;
  titles?: Array<{ title?: string }>;
  creators?: Array<{ name?: string; givenName?: string; familyName?: string }>;
  publisher?: string;
  publicationYear?: number;
  url?: string;
  descriptions?: Array<{ description?: string }>;
}

/**
 * Looks up a DOI in DataCite, which registers datasets, theses and preprints
 * that CrossRef does not carry.
 * @returns The record's metadata, or undefined.
 */
export async function fetchDataciteByDoi(env: RegistryEnv, doi: string): Promise<RegistryEntry | undefined> {
  const payload = await fetchJson<{ data?: { attributes?: DataCiteAttributes } }>(
    env,
    `https://api.datacite.org/dois/${encodeURIComponent(doi)}`,
  );
  const attributes = payload?.data?.attributes;
  if (!attributes?.titles?.[0]?.title) {
    return undefined;
  }

  return {
    title: attributes.titles[0].title,
    authors: (attributes.creators ?? [])
      .map((creator) => creator.name ?? [creator.givenName, creator.familyName].filter(Boolean).join(" "))
      .filter((name): name is string => Boolean(name)),
    year: attributes.publicationYear,
    publisher: attributes.publisher,
    doi: attributes.doi,
    url: attributes.url,
    summary: attributes.descriptions?.[0]?.description,
  };
}

// Semantic Scholar

// Requested explicitly, because the graph API returns only `paperId` otherwise.
const SEMANTIC_SCHOLAR_FIELDS =
  "title,abstract,year,authors,externalIds,venue,publicationVenue,openAccessPdf,journal";

interface SemanticScholarPaper {
  title?: string;
  abstract?: string | null;
  year?: number | null;
  venue?: string;
  authors?: Array<{ name?: string }>;
  externalIds?: { DOI?: string | null } | null;
  publicationVenue?: { name?: string } | null;
  openAccessPdf?: { url?: string } | null;
  journal?: { name?: string; volume?: string; pages?: string } | null;
}

/**
 * Matches a title against Semantic Scholar's dedicated title-match endpoint.
 * Unlike the generic `/paper/search`, this one is built for "is there a paper
 * with roughly this title", so it either returns the single best match or a 404
 * — which `fetchJson` already turns into undefined.
 * @returns The matched paper, or undefined when nothing matches.
 */
export async function fetchSemanticScholarByTitle(env: RegistryEnv, title: string): Promise<RegistryEntry | undefined> {
  const payload = await fetchJson<{ data?: SemanticScholarPaper[] }>(
    env,
    `https://api.semanticscholar.org/graph/v1/paper/search/match?query=${encodeURIComponent(title)}&fields=${SEMANTIC_SCHOLAR_FIELDS}`,
  );
  const paper = payload?.data?.[0];
  return paper?.title ? mapSemanticScholarPaper(paper) : undefined;
}

/**
 * Looks up a DOI in Semantic Scholar. Worth querying even after CrossRef
 * succeeds, because Semantic Scholar holds abstracts for a large share of the
 * works CrossRef indexes without one.
 * @returns The paper's metadata, or undefined when the DOI is unknown.
 */
export async function fetchSemanticScholarByDoi(env: RegistryEnv, doi: string): Promise<RegistryEntry | undefined> {
  const paper = await fetchJson<SemanticScholarPaper>(
    env,
    `https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeDoiPathSegment(doi)}?fields=${SEMANTIC_SCHOLAR_FIELDS}`,
  );
  return paper?.title ? mapSemanticScholarPaper(paper) : undefined;
}

function mapSemanticScholarPaper(paper: SemanticScholarPaper): RegistryEntry {
  return {
    title: parseString(paper.title),
    authors: (paper.authors ?? [])
      .map((author) => parseString(author.name))
      .filter((name): name is string => Boolean(name)),
    year: paper.year ?? undefined,
    journal:
      parseString(paper.venue) ?? parseString(paper.journal?.name) ?? parseString(paper.publicationVenue?.name),
    volume: parseString(paper.journal?.volume),
    pages: parseString(paper.journal?.pages),
    doi: parseString(paper.externalIds?.DOI ?? undefined),
    // Present but empty whenever no open-access copy is known.
    url: parseString(paper.openAccessPdf?.url),
    summary: paper.abstract ? parseXmlText(paper.abstract) : undefined,
  };
}

// Published version of a preprint

// arXiv's own DOIs (10.48550) and bioRxiv/medRxiv's (10.1101) name the preprint itself, never the journal version.
const PREPRINT_DOI = /^10\.(48550|1101)\//i;

interface CrossRefRelations {
  message?: { relation?: { "is-preprint-of"?: Array<{ "id-type"?: string; id?: string }> } };
}

/** What identifies the preprint: its arXiv id, its DOI, or both. */
export interface PreprintIds {
  arxivId?: string | undefined;
  doi?: string | undefined;
}

/**
 * Asks arXiv first (free, and the authors fill it in), then CrossRef for a preprint DOI.
 * @returns the published version's DOI, or undefined when none is recorded
 */
export async function findPublishedDoi(env: RegistryEnv, preprint: PreprintIds): Promise<Doi | undefined> {
  if (preprint.arxivId) {
    const fromArxiv = (await fetchArxivByIdentifier(env, preprint.arxivId))?.doi;
    if (isJournalDoi(fromArxiv)) return toDoi(fromArxiv);
  }
  if (!preprint.doi || !PREPRINT_DOI.test(preprint.doi)) return undefined;
  const work = await fetchJson<CrossRefRelations>(env, `https://api.crossref.org/works/${encodeURIComponent(preprint.doi)}`);
  const related = work?.message?.relation?.["is-preprint-of"]?.find((r) => r["id-type"] === "doi")?.id;
  return isJournalDoi(related) ? toDoi(related) : undefined;
}

function isJournalDoi(doi: string | undefined): doi is string {
  return Boolean(doi) && !PREPRINT_DOI.test(doi!);
}
