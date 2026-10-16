/** Fetches a remote catalog index conditionally and falls back to the device's cached copy when the fetch fails. */
// CONTRACT: documents/contracts/templates.md#cache

import type { ILogger } from "../../../ports/index.js";
import type { CachedIndex, CachedSourceId, FetchLike, TemplateCache } from "./templateSource.js";

export interface CachedIndexRequest {
  url: string;
  source: CachedSourceId;
  /** Whether a body is a usable index; a body it refuses is never cached and never sent as a validator. */
  accepts(body: string): boolean;
}

export interface CachedIndexDeps {
  fetch: FetchLike;
  cache: TemplateCache;
  logger: ILogger;
}

export interface CachedIndexResult {
  body: string;
  fromCache: boolean;
}

type Attempt = { body: string } | { notModified: true } | { failure: Record<string, unknown> };

async function attempt(request: CachedIndexRequest, deps: CachedIndexDeps, cached: CachedIndex | undefined, signal?: AbortSignal): Promise<Attempt> {
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
    return { failure: { error: error instanceof Error ? error.message : String(error) } };
  }
}

/** Returns the freshest accepted index; throws when the fetch fails and no accepted cached copy exists. */
export async function fetchCachedIndex(request: CachedIndexRequest, deps: CachedIndexDeps, signal?: AbortSignal): Promise<CachedIndexResult> {
  const stored = await deps.cache.readIndex(request.source);
  const cached = stored !== undefined && request.accepts(stored.body) ? stored : undefined;
  const result = await attempt(request, deps, cached, signal);
  if ("body" in result) { return { body: result.body, fromCache: false }; }
  if ("notModified" in result) { return { body: cached!.body, fromCache: true }; }
  const context = { url: request.url, source: request.source, ...result.failure };
  if (cached !== undefined) {
    await deps.logger.log("WARN", "templates", "Template index fetch failed; using the cached index", context);
    return { body: cached.body, fromCache: true };
  }
  await deps.logger.log("ERROR", "templates", "Template index fetch failed and nothing is cached", context);
  const detail = "status" in result.failure ? `status ${String(result.failure["status"])}` : String(result.failure["error"]);
  throw new Error(`Could not load the template index from ${request.url} (${detail})`);
}
