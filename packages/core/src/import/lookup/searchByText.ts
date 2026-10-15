/** Finds a paper in the online registries from noisy front-matter text or a title. */
import { completeness, type ResolvedMetadata } from "../metadata/index.js";
import { plainRecord, type RegistryEnv, type RegistryRecord } from "../registries/index.js";
import { searchAllRegistries } from "./registrySearch.js";
import { normalizeForMatch, TITLE_MATCH_THRESHOLD, titleOverlap, titlePosition } from "./titleMatch.js";

interface Pick {
  record: RegistryRecord;
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
    const key = normalizeForMatch(candidate).slice(0, 120);
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
  return plainRecord(bestMatch(groups.flat(), query, normalized));
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
function bestMatch(records: RegistryRecord[], query: string, normalized: string): RegistryRecord | undefined {
  const queryWords = normalized.split(" ").filter((word) => word.length > 2);
  let best: Pick | undefined;
  for (const record of records) {
    if (!record.title || record.isComponent) {
      continue;
    }
    if (titleOverlap(record.title, query) < TITLE_MATCH_THRESHOLD) {
      continue;
    }
    const position = titlePosition(record.title, queryWords);
    if (position === undefined) {
      continue;
    }
    const verbatim = ` ${normalized} `.includes(` ${normalizeForMatch(record.title)} `);
    const pick: Pick = { record, position, verbatim, score: completeness(record) };
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
