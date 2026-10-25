/** Looks up Semantic Scholar records by title match or DOI. */
import { encodeDoiPathSegment } from "../identifiers/index.js";
import { fetchJson, type RegistryEnv } from "./http.js";
import { parseXmlText } from "./text.js";
import { parseString } from "../metadata/index.js";
import type { RegistryEntry } from "./registryMetadata.js";

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
