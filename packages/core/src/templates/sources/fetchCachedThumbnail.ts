/** Returns a remote template thumbnail from the device cache, or fetches and caches it; logs and returns undefined when neither works. */
// CONTRACT: documents/contracts/templates.md#cache

import type { ILogger, FetchLike } from "../../ports/index.js";
import type { TemplateCache } from "./templateSource.js";
import { formatError } from "../../errors/index.js";

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

async function download(request: CachedThumbnailRequest, deps: CachedThumbnailDeps, signal?: AbortSignal): Promise<Uint8Array | Record<string, unknown>> {
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
  const result = await download(request, deps, signal);
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
