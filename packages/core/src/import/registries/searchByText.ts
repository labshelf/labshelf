/** Finds a paper in the online registries from noisy front-matter text or a title, and lists plausible matches. */
import { searchCrossref, fetchSemanticScholarByTitle } from "./doiRegistries.js";
import { searchDblp, searchEuropePmc } from "./bibliographic.js";
import { openAlexSearch } from "./openalex.js";
import { derivePlainMetadata, type RegistryEntry, type RegistryEnv } from "./http.js";
import { deriveCompleteness, type ResolvedMetadata } from "./metadata.js";

interface Pick {
  record: RegistryEntry;
  position: number;
  verbatim: boolean;
  score: number;
}

/**
 * Tries a series of differently-shaped queries until one is recognised.
 *
 * A registry may miss a full page of front matter yet match the bare title, or
 * the other way round when the title is generic and the authors disambiguate
 * it. Trying several shapes costs one request each and rescues papers a single
 * query shape would lose.
 * @returns The first confident match and the query that found it.
 */
export async function searchOnlineByQueries(
  queries: Array<string | undefined>,
  env: RegistryEnv = {},
): Promise<{ metadata: ResolvedMetadata; query: string } | undefined> {
  const tried = new Set<string>();
  for (const query of queries) {
    const candidate = query?.trim();
    if (!candidate || candidate.length < 12) {
      continue;
    }
    // TRAP: a long junk title (an access stamp) can be a prefix of the page text, so only an identical query counts as tried.
    const key = normalizeForMatch(candidate);
    if (tried.has(key)) {
      continue;
    }
    tried.add(key);

    const metadata = await searchOnlineByText(candidate, env).catch(() => undefined);
    if (metadata) {
      return { metadata, query: candidate };
    }
  }
  return undefined;
}

/**
 * Finds a paper from noisy front-matter text — the fallback for PDFs that
 * state no identifier, and the only route for text recovered by OCR.
 * @returns A confidently matching record, or undefined.
 */
export async function searchOnlineByText(query: string, env: RegistryEnv = {}): Promise<ResolvedMetadata | undefined> {
  const normalized = normalizeForMatch(query);
  if (normalized.length < 20) {
    return undefined;
  }

  // Every index has blind spots: CrossRef misses many conference papers, DBLP
  // covers exactly those, Europe PMC covers biomedical venues, and Semantic
  // Scholar's match endpoint is the most tolerant of OCR noise. Asking them all
  // at once costs one round trip and rescues papers any single index would lose.
  const searchTerm = normalized.slice(0, 600);
  const groups = await Promise.all(searchAllRegistries(env, searchTerm));
  return derivePlainMetadata(bestMatch(groups.flat(), query, normalized));
}

/**
 * Looks a paper up by a title already believed to be correct.
 * @returns A confidently matching record, or undefined.
 */
export async function searchOnlineByTitle(title: string, env: RegistryEnv = {}): Promise<ResolvedMetadata | undefined> {
  return title.trim().length >= 12 ? searchOnlineByText(title, env) : undefined;
}

// Word overlap alone accepts far too much when the query is a page of front
// matter: the three words of "Depth First Search" all occur somewhere in the
// abstract of a paper about graph search. A title the PDF really prints sits
// in one place, and near the top, so each record is located in the query and
// the earliest one wins. Ties — every record sits at 0 when the query is just
// a title — go to the record whose title occurs verbatim ("Attention Is All
// You Need" against "Is Attention All You Need?"), then to the most complete.
function bestMatch(records: RegistryEntry[], query: string, normalized: string): RegistryEntry | undefined {
  const queryWords = normalized.split(" ").filter((word) => word.length > 2);
  let best: Pick | undefined;
  for (const record of records) {
    if (!record.title || record.isComponent) {
      continue;
    }
    if (deriveTitleOverlap(record.title, query) < TITLE_MATCH_THRESHOLD) {
      continue;
    }
    const position = findTitlePosition(record.title, queryWords);
    if (position === undefined) {
      continue;
    }
    const verbatim = ` ${normalized} `.includes(` ${normalizeForMatch(record.title)} `);
    const pick: Pick = { record, position, verbatim, score: deriveCompleteness(record) };
    if (!best || beats(pick, best)) {
      best = pick;
    }
  }
  return best?.record;
}

function beats(pick: Pick, best: Pick): boolean {
  return (
    pick.position < best.position ||
    (pick.position === best.position && pick.verbatim && !best.verbatim) ||
    (pick.position === best.position && pick.verbatim === best.verbatim && pick.score > best.score)
  );
}

// Fans one free-text query out to every registry that supports it.
function searchAllRegistries(env: RegistryEnv, query: string, rows = 3): Array<Promise<RegistryEntry[]>> {
  const single = (promise: Promise<RegistryEntry | undefined>): Promise<RegistryEntry[]> =>
    promise.then((record) => (record ? [record] : [])).catch(() => []);

  return [
    searchCrossref(env, query, rows).catch((): RegistryEntry[] => []),
    openAlexSearch(env, query, rows).catch((): RegistryEntry[] => []),
    searchEuropePmc(env, query, rows).catch((): RegistryEntry[] => []),
    searchDblp(env, query, rows).catch((): RegistryEntry[] => []),
    single(fetchSemanticScholarByTitle(env, query)),
  ];
}

/**
 * Returns every plausible match for a query, best first, for a human to choose
 * between. A short title can match several real works closely — "Attention Is
 * All You Need" and the chapter "Is Attention All You Need?" score alike — so
 * an interactive lookup should offer the options rather than pick one.
 * @returns Deduplicated candidates ordered by how well they match the query.
 */
export async function searchOnlineCandidates(query: string, limit = 8, env: RegistryEnv = {}): Promise<ResolvedMetadata[]> {
  const normalized = normalizeForMatch(query);
  if (normalized.length < 6) {
    return [];
  }

  const searchTerm = normalized.slice(0, 600);
  const groups = await Promise.all(searchAllRegistries(env, searchTerm, limit));

  const byKey = new Map<string, { record: ResolvedMetadata; score: number }>();
  for (const record of groups.flat()) {
    if (!record.title || record.isComponent) {
      continue;
    }
    const key = (record.doi ?? record.title).toLowerCase();
    const score = deriveTitleOverlap(record.title, query);
    const existing = byKey.get(key);
    if (!existing || score > existing.score) {
      byKey.set(key, { record: derivePlainMetadata(record)!, score });
    }
  }

  return [...byKey.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.record);
}

// A search hit is accepted only when this much of its title also appears in the
// text we searched with, which keeps a plausible-but-wrong paper out.
const TITLE_MATCH_THRESHOLD = 0.75;

// A title shorter than this proves nothing when found inside a page of text.
const MIN_TITLE_WORDS_IN_PAGE = 4;
// Up to this many significant words, every one must be printed: on a page about
// "non-equilibrium dynamics", the chapter "Non equilibrium critical dynamics"
// matches three words of four, and the missing one is what makes it another work.
const SHORT_TITLE_WORDS = 6;

/**
 * Measures how much of `candidate` appears in `source`, ignoring case,
 * punctuation and word order. Asymmetric on purpose: `source` may be a whole
 * page of front matter, of which the title is only a part.
 * @returns Fraction of the candidate's significant words found in the source.
 */
export function deriveTitleOverlap(candidate: string, source: string): number {
  const candidateWords = significantWords(candidate);
  if (candidateWords.size === 0) {
    return 0;
  }

  const sourceWords = significantWords(source);
  let shared = 0;
  for (const word of candidateWords) {
    if (sourceWords.has(word)) {
      shared += 1;
    }
  }
  return shared / candidateWords.size;
}

// Finds where in the query a title is printed: the first run of words, about as
// long as the title, holding most of its words. Returns 0 when the query is
// itself title-sized, and undefined when the title's words are only scattered
// across a page — or when the title is too short for that to mean anything.
function findTitlePosition(title: string, queryWords: string[]): number | undefined {
  const titleWords = significantWords(title);
  if (queryWords.length <= titleWords.size * 3) {
    return 0;
  }
  if (titleWords.size < MIN_TITLE_WORDS_IN_PAGE) {
    return undefined;
  }

  const span = titleWords.size + Math.max(2, Math.floor(titleWords.size / 2));
  const needed = titleWords.size <= SHORT_TITLE_WORDS ? titleWords.size : Math.ceil(titleWords.size * TITLE_MATCH_THRESHOLD);
  for (let start = 0; start < queryWords.length; start += 1) {
    if (!titleWords.has(queryWords[start]!)) {
      continue;
    }
    const found = new Set(queryWords.slice(start, start + span).filter((word) => titleWords.has(word)));
    if (found.size >= needed) {
      return start;
    }
  }
  return undefined;
}

function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9à-ÿ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function significantWords(value: string): Set<string> {
  return new Set(
    normalizeForMatch(value)
      .split(" ")
      .filter((word) => word.length > 2),
  );
}
