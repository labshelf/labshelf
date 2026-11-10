// Pins GET/HEAD /busytex/<version>/<file>: the browser LaTeX engine's files from R2, typed and cached for a year, 404 for anything else.
import { busytexAsset, handleBusytexRequest, type AssetBucket, type AssetObjectBody, type BusytexDeps } from "../../src/directory/busytexAssets";

const ORIGIN = "https://labshelf.org";

interface Fake { deps: BusytexDeps; reads: string[]; heads: string[]; cached: Map<string, Response> }

function fake(objects: Record<string, string>, withCache = true): Fake {
  const reads: string[] = [];
  const heads: string[] = [];
  const cached = new Map<string, Response>();
  const object = (key: string): AssetObjectBody | null => {
    const text = objects[key];
    if (text === undefined) { return null; }
    const bytes = new TextEncoder().encode(text);
    return { httpEtag: `"etag-${key}"`, size: bytes.length, body: new Response(bytes).body! };
  };
  const bucket: AssetBucket = {
    get: async (key) => { reads.push(key); return object(key); },
    head: async (key) => { heads.push(key); const found = object(key); return found && { httpEtag: found.httpEtag, size: found.size }; },
  };
  const cache = {
    match: async (request: RequestInfo | URL) => cached.get(new Request(request).url)?.clone(),
    put: async (request: RequestInfo | URL, response: Response) => {
      const body = await response.arrayBuffer();
      cached.set(new Request(request).url, new Response(body, { status: response.status, headers: response.headers }));
    },
  } as Pick<Cache, "match" | "put">;
  return { deps: withCache ? { bucket, cache } : { bucket }, reads, heads, cached };
}

const get = (path: string, init?: RequestInit) => new Request(`${ORIGIN}${path}`, init);

describe("busytexAsset", () => {
  it("maps each served file type to its key and content type", () => {
    expect(busytexAsset("/busytex/1.4.1/busytex.wasm")).toEqual({ key: "busytex/1.4.1/busytex.wasm", contentType: "application/wasm" });
    expect(busytexAsset("/busytex/1.4.1/busytex_worker.js")?.contentType).toBe("text/javascript; charset=utf-8");
    expect(busytexAsset("/busytex/1.4.1/texlive-basic.data")?.contentType).toBe("application/octet-stream");
    expect(busytexAsset("/busytex/1.4.1/texlive-basic.js.providespackage.txt")?.contentType).toBe("text/plain; charset=utf-8");
  });

  it("refuses other paths, nested paths, traversal and unknown types", () => {
    for (const path of ["/busytex/1.4.1/", "/busytex/busytex.js", "/busytex/1.4.1/a/b.js", "/busytex/../x/y.js", "/busytex/1.4.1/..js", "/busytex/1.4.1/x.html", "/api/busytex/1.4.1/x.js"]) {
      expect(busytexAsset(path)).toBeNull();
    }
  });
});

describe("handleBusytexRequest", () => {
  const objects = { "busytex/1.4.1/busytex.wasm": "wasm-bytes", "busytex/1.4.1/busytex.js": "js" };

  it("answers GET from R2 with type, length, immutable caching and ETag", async () => {
    const f = fake(objects);
    const response = await handleBusytexRequest(get("/busytex/1.4.1/busytex.wasm"), f.deps);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/wasm");
    expect(response.headers.get("content-length")).toBe("10");
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(response.headers.get("etag")).toBe('"etag-busytex/1.4.1/busytex.wasm"');
    expect(await response.text()).toBe("wasm-bytes");
    expect(f.reads).toEqual(["busytex/1.4.1/busytex.wasm"]);
  });

  it("serves a repeat request from the cache without reading R2, whatever the query string", async () => {
    const f = fake(objects);
    await (await handleBusytexRequest(get("/busytex/1.4.1/busytex.js"), f.deps)).text();
    const again = await handleBusytexRequest(get("/busytex/1.4.1/busytex.js?x=1"), f.deps);
    expect(await again.text()).toBe("js");
    expect(again.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(f.reads).toHaveLength(1);
  });

  it("hands the cache write to waitUntil when given", async () => {
    const f = fake(objects);
    const pending: Promise<unknown>[] = [];
    const response = await handleBusytexRequest(get("/busytex/1.4.1/busytex.js"), { ...f.deps, waitUntil: (p) => { pending.push(p); } });
    expect(await response.text()).toBe("js");
    expect(pending).toHaveLength(1);
    await Promise.all(pending);
    expect(f.cached.size).toBe(1);
  });

  it("reads R2 on every request without a cache", async () => {
    const f = fake(objects, false);
    await (await handleBusytexRequest(get("/busytex/1.4.1/busytex.js"), f.deps)).text();
    await (await handleBusytexRequest(get("/busytex/1.4.1/busytex.js"), f.deps)).text();
    expect(f.reads).toHaveLength(2);
  });

  it("answers HEAD from the object's metadata, without a body", async () => {
    const f = fake(objects);
    const response = await handleBusytexRequest(get("/busytex/1.4.1/busytex.wasm", { method: "HEAD" }), f.deps);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/wasm");
    expect(response.headers.get("content-length")).toBe("10");
    expect(response.body).toBeNull();
    expect(f.heads).toEqual(["busytex/1.4.1/busytex.wasm"]);
    expect(f.reads).toEqual([]);
  });

  it("answers 304 when If-None-Match carries the object's ETag", async () => {
    const f = fake(objects, false);
    const response = await handleBusytexRequest(get("/busytex/1.4.1/busytex.js", { headers: { "if-none-match": '"etag-busytex/1.4.1/busytex.js"' } }), f.deps);
    expect(response.status).toBe(304);
  });

  it("answers 404 for a missing object or an unknown path, and 405 for other methods", async () => {
    const f = fake(objects);
    expect((await handleBusytexRequest(get("/busytex/1.4.1/biber.wasm"), f.deps)).status).toBe(404);
    expect((await handleBusytexRequest(get("/busytex/1.4.1/biber.wasm", { method: "HEAD" }), f.deps)).status).toBe(404);
    expect((await handleBusytexRequest(get("/busytex/1.4.1/index.html"), f.deps)).status).toBe(404);
    expect((await handleBusytexRequest(get("/busytex/1.4.1/busytex.js", { method: "POST" }), f.deps)).status).toBe(405);
    expect(f.cached.size).toBe(0);
  });
});
