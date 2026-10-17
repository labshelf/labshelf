// Builds the library's citation map from OpenAlex, refetching only the cache entries that are missing or stale.

import { openAlexWork, type OpenAlexCitationWork, type RegistryEnv } from "../registries/index.js";
import type { IFileSystem, ILogger } from "../../ports/index.js";
import type { PaperRecord } from "../../model/index.js";
import { doiLookup } from "../../library/index.js";
import { citationCache, isStale, type CachedWork, type CitationCache } from "./citationCache.js";
import { countMissingCitations, type CitationLink, type ResolvedPaper } from "./missingCitations.js";

/** Stays under OpenAlex's polite limit of ten requests a second. */
const CONCURRENT_LOOKUPS = 4;

export interface CitationMapEnv {
  registry: RegistryEnv;
  fs: IFileSystem;
  /** The library's device-local OpenAlex cache folder. */
  cacheDir: string;
  logger?: ILogger | undefined;
  now?: () => Date;
}

export interface CitationMapOptions {
  /** How many library papers must cite a work before it is listed; 3 by default. */
  minCitingPapers?: number;
  /** How many missing works are listed at most; 50 by default. */
  maxMissing?: number;
  /** How old a cache entry may get before it is fetched again; 30 days by default. */
  maxAgeDays?: number;
}

/** A work the library lacks, with the ids of the library papers that cite it. */
export interface MissingWork extends Omit<OpenAlexCitationWork, "references"> {
  title: string;
  citedBy: string[];
}

export interface CitationMap {
  links: CitationLink[];
  /** Most cited first. */
  missing: MissingWork[];
  /** Library papers with a DOI that OpenAlex did not return. */
  unresolved: string[];
}

/** Resolves every library paper with a DOI, then lists the works its papers often cite but the library lacks. */
export async function buildCitationMap(
  env: CitationMapEnv,
  papers: ReadonlyArray<Pick<PaperRecord, "id" | "doi">>,
  options: CitationMapOptions = {},
): Promise<CitationMap> {
  const { minCitingPapers = 3, maxMissing = 50, maxAgeDays = 30 } = options;
  const now = env.now?.() ?? new Date();
  const cache = citationCache(env.fs, env.cacheDir, env.logger);
  const fresh = (entry: CachedWork | undefined): entry is CachedWork => entry !== undefined && !isStale(entry, now, maxAgeDays);

  const resolved: ResolvedPaper[] = [];
  const unresolved: string[] = [];
  await eachLimited(papers.filter((paper) => paper.doi), async ({ id, doi }) => {
    const work = await paperWork(env, cache, id, doi!, now, fresh);
    if (work) {
      resolved.push({ paperId: id, work });
    } else {
      unresolved.push(id);
    }
  });

  const { links, candidates } = countMissingCitations(resolved, minCitingPapers);
  const libraryDoi = doiLookup(papers);
  const missing: MissingWork[] = [];
  await eachLimited(candidates.slice(0, maxMissing), async ({ workId, citedBy }) => {
    const cached = await cache.readWork(workId);
    const work = fresh(cached) ? cached.work : await fetchWork(env, cache, workId, now);
    if (work?.title && !(work.doi && libraryDoi(work.doi))) {
      const { references: _, ...shown } = work;
      missing.push({ ...shown, title: work.title, citedBy });
    }
  });
  const order = new Map(candidates.map((candidate, index) => [candidate.workId, index]));
  missing.sort((a, b) => order.get(a.workId)! - order.get(b.workId)!);
  await env.logger?.log("INFO", "citationMap", "Built the citation map", {
    papers: resolved.length, unresolved: unresolved.length, links: links.length, missing: missing.length,
  });
  return { links, missing, unresolved };
}

async function paperWork(
  env: CitationMapEnv, cache: CitationCache, paperId: string, doi: string, now: Date,
  fresh: (entry: CachedWork | undefined) => entry is CachedWork,
): Promise<OpenAlexCitationWork | undefined> {
  const cached = await cache.readPaper(paperId);
  if (fresh(cached) && cached.doi?.toLowerCase() === doi.toLowerCase()) {
    return cached.work;
  }
  // TRAP: a failed lookup is not cached, because fetchJson reports a 429 or a timeout exactly like an unknown DOI.
  const work = await openAlexWork(env.registry, { doi });
  if (work) {
    await cache.writePaper(paperId, { fetchedAt: now.toISOString(), doi, work });
  }
  return work;
}

async function fetchWork(env: CitationMapEnv, cache: CitationCache, workId: string, now: Date): Promise<OpenAlexCitationWork | undefined> {
  const work = await openAlexWork(env.registry, { workId });
  if (work) {
    // Only library papers need their references; a cited work keeps its display line.
    await cache.writeWork({ fetchedAt: now.toISOString(), work: { ...work, references: [] } });
  }
  return work;
}

async function eachLimited<T>(items: T[], run: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      await run(items[next++]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENT_LOOKUPS, items.length) }, worker));
}
