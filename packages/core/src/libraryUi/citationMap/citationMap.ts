// Builds the library's citation map from OpenAlex, refetching only the cache entries that are missing or stale, and
// reads and writes the OpenAlex citation cache: one file per library paper and one per cited work, each with its fetch date.
// CONTRACT: documents/contracts/library-format.md#device-local-files
import { openAlexWork, type OpenAlexCitationWork, type RegistryEnv } from "../../import/registries/index.js";
import { isRecord, isStringArray } from "../../guards/index.js";
import { formatError } from "../../errors/index.js";
import type { IFileSystem, ILogger } from "../../ports/index.js";
import type { PaperRecord } from "../../model/index.js";
import { createDoiFinder } from "../../library/index.js";

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
  links: CitationEdge[];
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
  const cache = createCitationCache(env.fs, env.cacheDir, env.logger);
  const fresh = (entry: CitationCacheEntry | undefined): entry is CitationCacheEntry => entry !== undefined && !isStale(entry, now, maxAgeDays);

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
  const libraryDoi = createDoiFinder(papers);
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
  fresh: (entry: CitationCacheEntry | undefined) => entry is CitationCacheEntry,
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

const CACHE_MODULE = "citationMap";

/** A cached lookup; `doi` is the DOI a library paper was looked up by, absent for a cited work. */
interface CitationCacheEntry {
  fetchedAt: string;
  doi?: string | undefined;
  work: OpenAlexCitationWork;
}

interface CitationCache {
  readPaper(paperId: string): Promise<CitationCacheEntry | undefined>;
  writePaper(paperId: string, entry: CitationCacheEntry): Promise<void>;
  readWork(workId: string): Promise<CitationCacheEntry | undefined>;
  writeWork(entry: CitationCacheEntry): Promise<void>;
}

/** Opens the cache under `dir` (POSIX path); a missing, unreadable or malformed file reads as a miss. */
function createCitationCache(fs: IFileSystem, dir: string, logger?: ILogger): CitationCache {
  const read = async (path: string): Promise<CitationCacheEntry | undefined> => {
    if (!(await fs.exists(path))) {
      return undefined;
    }
    try {
      const entry = parseCachedWork(JSON.parse(await fs.readText(path)));
      if (!entry) {
        await logger?.log("WARN", CACHE_MODULE, "Ignoring a malformed citation cache file", { path });
      }
      return entry;
    } catch (error) {
      await logger?.log("WARN", CACHE_MODULE, "Ignoring an unreadable citation cache file", { path, message: formatError(error) });
      return undefined;
    }
  };
  const write = async (sub: string, name: string, entry: CitationCacheEntry): Promise<void> => {
    await fs.ensureDir(`${dir}/${sub}`);
    await fs.writeText(`${dir}/${sub}/${name}.json`, `${JSON.stringify(entry, null, 2)}\n`);
  };
  return {
    readPaper: (paperId) => read(`${dir}/papers/${paperId}.json`),
    writePaper: (paperId, entry) => write("papers", paperId, entry),
    readWork: (workId) => read(`${dir}/works/${workId}.json`),
    writeWork: (entry) => write("works", entry.work.workId, entry),
  };
}

/** @returns whether `entry` was fetched more than `maxAgeDays` before `now` */
function isStale(entry: CitationCacheEntry, now: Date, maxAgeDays: number): boolean {
  const fetched = Date.parse(entry.fetchedAt);
  return Number.isNaN(fetched) || now.getTime() - fetched > maxAgeDays * 86_400_000;
}

function parseCachedWork(value: unknown): CitationCacheEntry | undefined {
  if (!isRecord(value) || typeof value.fetchedAt !== "string" || !isRecord(value.work)) {
    return undefined;
  }
  const work = value.work;
  if (typeof work.workId !== "string" || !/^W\d+$/.test(work.workId) || !isStringArray(work.authors) || !isStringArray(work.references)) {
    return undefined;
  }
  return {
    fetchedAt: value.fetchedAt,
    doi: optionalString(value.doi),
    work: {
      workId: work.workId,
      doi: optionalString(work.doi),
      title: optionalString(work.title),
      authors: work.authors,
      year: typeof work.year === "number" ? work.year : undefined,
      citedByCount: typeof work.citedByCount === "number" ? work.citedByCount : 0,
      references: work.references.filter((ref) => /^W\d+$/.test(ref)),
    },
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** A library paper OpenAlex resolved. */
interface ResolvedPaper {
  paperId: string;
  work: OpenAlexCitationWork;
}

/** One library paper citing another. */
export interface CitationEdge {
  from: string;
  to: string;
}

/** A work outside the library and the library papers that cite it. */
interface MissingCandidate {
  workId: string;
  citedBy: string[];
}

/**
 * Splits the references of resolved library papers into links between library papers and works the library lacks.
 * @returns the links, and the missing works cited by at least `minCitingPapers` papers, most cited first
 */
function countMissingCitations(
  resolved: ResolvedPaper[],
  minCitingPapers: number,
): { links: CitationEdge[]; candidates: MissingCandidate[] } {
  const paperOfWork = new Map<string, string>();
  for (const { paperId, work } of resolved) {
    if (!paperOfWork.has(work.workId)) {
      paperOfWork.set(work.workId, paperId);
    }
  }
  const links: CitationEdge[] = [];
  const citers = new Map<string, Set<string>>();
  for (const { paperId, work } of resolved) {
    const linked = new Set<string>();
    for (const ref of work.references) {
      const target = paperOfWork.get(ref);
      if (target === undefined) {
        citers.set(ref, (citers.get(ref) ?? new Set()).add(paperId));
      } else if (target !== paperId && !linked.has(target)) {
        linked.add(target);
        links.push({ from: paperId, to: target });
      }
    }
  }
  const candidates = [...citers]
    .filter(([, papers]) => papers.size >= minCitingPapers)
    .map(([workId, papers]) => ({ workId, citedBy: [...papers] }))
    .sort((a, b) => b.citedBy.length - a.citedBy.length || a.workId.localeCompare(b.workId));
  return { links, candidates };
}
