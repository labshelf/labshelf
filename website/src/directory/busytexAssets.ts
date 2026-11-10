// The browser LaTeX engine's files (texlyre-busytex, AGPL-3.0) served same-origin from R2: GET and HEAD /busytex/<version>/<file> answer the
// object at key busytex/<version>/<file>. The engine starts its Worker from this folder, so the files must come from labshelf.org itself.

/** The part of an R2 object the handler reads. */
interface AssetObject { httpEtag: string; size: number }
export interface AssetObjectBody extends AssetObject { body: ReadableStream<Uint8Array> }

/** The part of the R2 bucket binding the handler uses. */
export interface AssetBucket {
  get(key: string): Promise<AssetObjectBody | null>;
  head(key: string): Promise<AssetObject | null>;
}

export interface BusytexDeps {
  bucket: AssetBucket;
  /** The edge cache (caches.default in the Worker); absent, every request reads R2. */
  cache?: Pick<Cache, "match" | "put">;
  /** Keeps the cache write alive after the response is returned (ctx.waitUntil in the Worker). */
  waitUntil?: (promise: Promise<unknown>) => void;
}

export const BUSYTEX_PREFIX = "/busytex/";

const PATH = /^\/busytex\/([A-Za-z0-9][\w.-]*)\/([A-Za-z0-9][\w.-]*)$/;

const CONTENT_TYPES: Record<string, string> = {
  wasm: "application/wasm",
  js: "text/javascript; charset=utf-8",
  data: "application/octet-stream",
  txt: "text/plain; charset=utf-8",
};

/** The R2 key and content type of a /busytex/ path; null for any other path or file type. */
export function busytexAsset(pathname: string): { key: string; contentType: string } | null {
  const match = PATH.exec(pathname);
  if (!match) { return null; }
  const [, version, file] = match as unknown as [string, string, string];
  if (version.includes("..") || file.includes("..")) { return null; }
  const contentType = CONTENT_TYPES[file.slice(file.lastIndexOf(".") + 1)];
  return contentType ? { key: `busytex/${version}/${file}`, contentType } : null;
}

function headers(contentType: string, object: AssetObject): Headers {
  return new Headers({
    "content-type": contentType,
    "content-length": String(object.size),
    "cache-control": "public, max-age=31536000, immutable",
    etag: object.httpEtag,
  });
}

const notFound = (): Response => new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });

/** Answers one /busytex/ request: from the edge cache when it holds the file, else from R2 (then cached); 404 for unknown paths and missing objects. */
export async function handleBusytexRequest(request: Request, deps: BusytexDeps): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
  }
  const url = new URL(request.url);
  const asset = busytexAsset(url.pathname);
  if (!asset) { return notFound(); }
  if (request.method === "HEAD") {
    const object = await deps.bucket.head(asset.key);
    return object ? new Response(null, { status: 200, headers: headers(asset.contentType, object) }) : notFound();
  }
  // One cache entry per file, whatever the query string or request headers.
  const cacheKey = new Request(`${url.origin}${url.pathname}`, { method: "GET" });
  const cached = await deps.cache?.match(cacheKey);
  if (cached) { return cached; }
  const object = await deps.bucket.get(asset.key);
  if (!object) { return notFound(); }
  const objectHeaders = headers(asset.contentType, object);
  if (request.headers.get("if-none-match") === object.httpEtag) {
    void object.body.cancel();
    return new Response(null, { status: 304, headers: objectHeaders });
  }
  const response = new Response(object.body, { status: 200, headers: objectHeaders });
  if (deps.cache) {
    const put = deps.cache.put(cacheKey, response.clone());
    if (deps.waitUntil) { deps.waitUntil(put); } else { await put; }
  }
  return response;
}
