/** Lists the Community catalog's templates and downloads their files at the commit the index was built from, over the template source port and the cached index and thumbnail fetches every remote source shares. */

import type { ILogger, FetchLike } from "../ports/index.js";
import { formatError } from "../errors/index.js";
import { deriveSha256Hex } from "../hash/index.js";
import { parseCatalogIndex, type CatalogEntry } from "./templateManifest/index.js";
import type { TemplateEntry, TemplateSourceId } from "./templateCatalog.js";

// CONTRACT: documents/contracts/templates.md#cache

/** One file of a template, with its path relative to the template's files/ folder. */
export interface TemplateFile {
  path: string;
  bytes: Uint8Array;
}

/** The entries a source offers, and whether they come from the device's cached index because the fetch failed. */
export interface TemplateListing {
  entries: TemplateEntry[];
  fromCache: boolean;
}

/** A place the gallery lists templates from and downloads their files from. */
export interface TemplateSource {
  readonly id: TemplateSourceId;
  /** The entries this source offers; throws only when there is neither a fresh nor a cached list. */
  list(signal?: AbortSignal): Promise<TemplateListing>;
  /** The entry's card image, or undefined when it has none or cannot be fetched (logged, never thrown). */
  thumbnail(entry: TemplateEntry, signal?: AbortSignal): Promise<Uint8Array | undefined>;
  /** Every file of the entry, checked against the path rules; throws with a user-facing message on any refusal. */
  files(entry: TemplateEntry, signal?: AbortSignal): Promise<TemplateFile[]>;
}

export type CachedSourceId = Exclude<TemplateSourceId, "mine">;

/** The last index a remote source received, as stored on this device. */
export interface CachedCatalogIndex {
  body: string;
  etag?: string;
}

/** Reads and writes the per-device copy of a remote source's index; never synced. */
export interface TemplateCache {
  readIndex(source: CachedSourceId): Promise<CachedCatalogIndex | undefined>;
  writeIndex(source: CachedSourceId, index: CachedCatalogIndex): Promise<void>;
  /** `key` is "<source>/<file>"; a key that would leave the source's thumbnails folder is refused. */
  readThumbnail(key: string): Promise<Uint8Array | undefined>;
  writeThumbnail(key: string, bytes: Uint8Array): Promise<void>;
}

export interface CachedCatalogIndexRequest {
  url: string;
  source: CachedSourceId;
  /** Whether a body is a usable index; a body it refuses is never cached and never sent as a validator. */
  accepts(body: string): boolean;
}

export interface CachedCatalogIndexDeps {
  fetch: FetchLike;
  cache: TemplateCache;
  logger: ILogger;
}

export interface CachedCatalogIndexResult {
  body: string;
  /** True only when the fetch failed and the cached copy stands in; a 304 confirms the cached copy is current. */
  /** True only when the fetch failed; a 304 confirms the cached copy is current. */
  fromCache: boolean;
}

type Attempt = { body: string } | { notModified: true } | { failure: Record<string, unknown> };

async function attempt(request: CachedCatalogIndexRequest, deps: CachedCatalogIndexDeps, cached: CachedCatalogIndex | undefined, signal?: AbortSignal): Promise<Attempt> {
  const headers: Record<string, string> = {};
  if (cached?.etag !== undefined) { headers["If-None-Match"] = cached.etag; }
  try {
    const response = await deps.fetch(request.url, { headers, ...(signal ? { signal } : {}) });
    if (response.status === 304 && cached !== undefined) { return { notModified: true }; }
    if (!response.ok) { return { failure: { status: response.status } }; }
    const body = await response.text();
    if (!request.accepts(body)) { return { failure: { status: response.status, reason: "the index body was refused" } }; }
    const etag = response.headers.get("ETag");
    await deps.cache.writeIndex(request.source, etag === null ? { body } : { body, etag });
    return { body };
  } catch (error) {
    // An abort is the caller's decision, not a failure to paper over with stale data.
    if (signal?.aborted) { throw error; }
    return { failure: { error: formatError(error) } };
  }
}

/** Returns the freshest accepted index; throws when the fetch fails and no accepted cached copy exists. */
export async function fetchCachedCatalogIndex(request: CachedCatalogIndexRequest, deps: CachedCatalogIndexDeps, signal?: AbortSignal): Promise<CachedCatalogIndexResult> {
  const stored = await deps.cache.readIndex(request.source);
  const cached = stored !== undefined && request.accepts(stored.body) ? stored : undefined;
  const result = await attempt(request, deps, cached, signal);
  if ("body" in result) { return { body: result.body, fromCache: false }; }
  if ("notModified" in result) { return { body: cached!.body, fromCache: false }; }
  const context = { url: request.url, source: request.source, ...result.failure };
  if (cached !== undefined) {
    await deps.logger.log("WARN", "templates", "Template index fetch failed; using the cached index", context);
    return { body: cached.body, fromCache: true };
  }
  await deps.logger.log("ERROR", "templates", "Template index fetch failed and nothing is cached", context);
  const detail = "status" in result.failure ? `status ${String(result.failure["status"])}` : String(result.failure["error"]);
  throw new Error(`Could not load the template index from ${request.url} (${detail})`);
}

export interface CachedThumbnailRequest {
  url: string;
  /** "<source>/<file>", the cache key. */
  key: string;
  /** Whether bytes are the thumbnail the index promised; rejected bytes are neither cached nor returned. */
  accepts?(bytes: Uint8Array): Promise<boolean>;
}

interface CachedThumbnailDeps {
  fetch: FetchLike;
  cache: TemplateCache;
  logger: ILogger;
}

async function downloadThumbnail(request: CachedThumbnailRequest, deps: CachedThumbnailDeps, signal?: AbortSignal): Promise<Uint8Array | Record<string, unknown>> {
  try {
    const response = await deps.fetch(request.url, signal ? { signal } : undefined);
    if (!response.ok) { return { status: response.status }; }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (request.accepts && !(await request.accepts(bytes))) { return { reason: "the thumbnail does not match the index" }; }
    return bytes;
  } catch (error) {
    // An abort is the caller's decision, not a missing thumbnail.
    if (signal?.aborted) { throw error; }
    return { error: formatError(error) };
  }
}

export async function fetchCachedThumbnail(request: CachedThumbnailRequest, deps: CachedThumbnailDeps, signal?: AbortSignal): Promise<Uint8Array | undefined> {
  const stored = await deps.cache.readThumbnail(request.key);
  if (stored !== undefined && (!request.accepts || await request.accepts(stored))) { return stored; }
  const result = await downloadThumbnail(request, deps, signal);
  if (!(result instanceof Uint8Array)) {
    await deps.logger.log("WARN", "templates", "Template thumbnail could not be fetched", { url: request.url, key: request.key, ...result });
    return undefined;
  }
  try {
    await deps.cache.writeThumbnail(request.key, result);
  } catch (error) {
    await deps.logger.error("templates", error, { action: "cache template thumbnail", key: request.key });
  }
  return result;
}

// CONTRACT: documents/contracts/templates.md#community-catalog
const REPOSITORY = "https://cdn.jsdelivr.net/gh/labshelf/labshelf-templates";
export const COMMUNITY_INDEX_URL = `${REPOSITORY}@main/index.json`;
const UPDATING = "The catalog is updating, try again later";
const MODULE = "templates";

export interface CommunitySourceDeps {
  fetch: FetchLike;
  cache: TemplateCache;
  logger: ILogger;
}

interface RememberedIndex {
  commit: string;
  fromCache: boolean;
  entries: Map<string, CatalogEntry>;
}

function toGalleryEntry(entry: CatalogEntry): TemplateEntry {
  return {
    id: entry.id, name: entry.name, description: entry.description, category: entry.category, format: entry.format,
    engine: entry.engine, main: entry.main, license: entry.license, authors: entry.authors,
    ...(entry.compiler === undefined ? {} : { compiler: entry.compiler }),
    ...(entry.downloads === undefined ? {} : { downloads: entry.downloads }), source: "community",
    files: entry.files.map((file) => file.path),
  };
}

async function download(deps: CommunitySourceDeps, url: string, expected: { size: number; sha256: string }, signal?: AbortSignal): Promise<Uint8Array> {
  const response = await deps.fetch(url, signal ? { signal } : undefined);
  if (!response.ok) {
    await deps.logger.log("ERROR", MODULE, "Template file download failed", { url, status: response.status });
    throw new Error(`Could not download ${url} (status ${response.status})`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length !== expected.size || (await deriveSha256Hex(bytes)) !== expected.sha256) {
    await deps.logger.log("ERROR", MODULE, "Template file does not match the index", { url, size: bytes.length, expectedSize: expected.size });
    throw new Error(UPDATING);
  }
  return bytes;
}

export function createCommunitySource(deps: CommunitySourceDeps): TemplateSource {
  let remembered: RememberedIndex | undefined;

  async function load(signal?: AbortSignal): Promise<RememberedIndex> {
    const accepts = (body: string): boolean => parseCatalogIndex(body).ok;
    const { body, fromCache } = await fetchCachedCatalogIndex({ url: COMMUNITY_INDEX_URL, source: "community", accepts }, deps, signal);
    const parsed = parseCatalogIndex(body);
    // INVARIANT: fetchCachedCatalogIndex only returns bodies that accepts() let through.
    if (!parsed.ok) { throw new Error(`The catalog index is unreadable: ${parsed.reason}`); }
    for (const skipped of parsed.skipped) {
      await deps.logger.log("WARN", MODULE, "Community template left out of the gallery", { id: skipped.id, reason: skipped.reason });
    }
    remembered = { commit: parsed.commit, fromCache, entries: new Map(parsed.entries.map((entry) => [entry.id, entry])) };
    return remembered;
  }

  return {
    id: "community",
    async list(signal) {
      const index = await load(signal);
      return { entries: [...index.entries.values()].map(toGalleryEntry), fromCache: index.fromCache };
    },
    async thumbnail(entry, signal) {
      const index = remembered ?? await load(signal);
      const thumbnail = index.entries.get(entry.id)?.thumbnail;
      if (thumbnail === undefined) { return undefined; }
      const request = {
        url: `${REPOSITORY}@${index.commit}/templates/${entry.id}/preview/thumbnail.png`,
        key: `community/${thumbnail.sha256}.png`,
        accepts: async (bytes: Uint8Array) => bytes.length === thumbnail.size && (await deriveSha256Hex(bytes)) === thumbnail.sha256,
      };
      return fetchCachedThumbnail(request, deps, signal);
    },
    async files(entry, signal) {
      const index = remembered?.entries.has(entry.id) ? remembered : await load(signal);
      const catalogEntry = index.entries.get(entry.id);
      if (catalogEntry === undefined) {
        await deps.logger.log("ERROR", MODULE, "Template is not in the catalog index", { id: entry.id, commit: index.commit });
        throw new Error(UPDATING);
      }
      const files: TemplateFile[] = [];
      for (const file of catalogEntry.files) {
        const url = `${REPOSITORY}@${index.commit}/templates/${entry.id}/files/${file.path}`;
        files.push({ path: file.path, bytes: await download(deps, url, file, signal) });
      }
      return files;
    },
  };
}
