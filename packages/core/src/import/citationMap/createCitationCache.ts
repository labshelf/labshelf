// Reads and writes the OpenAlex citation cache: one file per library paper and one per cited work, each with its fetch date.
// CONTRACT: documents/contracts/library-format.md#researchopenalex
import type { OpenAlexCitationWork } from "../registries/index.js";
import { formatError } from "../../logging/index.js";
import type { IFileSystem, ILogger } from "../../ports/index.js";

const CACHE_MODULE = "citationMap";

/** A cached lookup; `doi` is the DOI a library paper was looked up by, absent for a cited work. */
export interface CitationCacheEntry {
  fetchedAt: string;
  doi?: string | undefined;
  work: OpenAlexCitationWork;
}

export interface CitationCache {
  readPaper(paperId: string): Promise<CitationCacheEntry | undefined>;
  writePaper(paperId: string, entry: CitationCacheEntry): Promise<void>;
  readWork(workId: string): Promise<CitationCacheEntry | undefined>;
  writeWork(entry: CitationCacheEntry): Promise<void>;
}

/** Opens the cache under `dir` (POSIX path); a missing, unreadable or malformed file reads as a miss. */
export function createCitationCache(fs: IFileSystem, dir: string, logger?: ILogger): CitationCache {
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
export function isStale(entry: CitationCacheEntry, now: Date, maxAgeDays: number): boolean {
  const fetched = Date.parse(entry.fetchedAt);
  return Number.isNaN(fetched) || now.getTime() - fetched > maxAgeDays * 86_400_000;
}

function parseCachedWork(value: unknown): CitationCacheEntry | undefined {
  if (!isObject(value) || typeof value.fetchedAt !== "string" || !isObject(value.work)) {
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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
