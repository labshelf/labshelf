/** Verifies the conditional, cache-backed fetch of a remote catalog index. */
import { fetchCachedCatalogIndex } from "../../../src/templates/sources/index.js";
import { contextLogger, memoryCache, scriptedFetch } from "./fakes";

const URL = "https://example.test/index.json";
const accepts = (body: string): boolean => body.startsWith("{");

function setup(replies: Parameters<typeof scriptedFetch>[0], cached?: { body: string; etag?: string }) {
  const fetch = scriptedFetch(replies);
  const cache = memoryCache(cached ? { community: cached } : {});
  const logger = contextLogger();
  const run = (over: { accepts?: (b: string) => boolean } = {}, signal?: AbortSignal) =>
    fetchCachedCatalogIndex({ url: URL, source: "community", accepts: over.accepts ?? accepts }, { fetch, cache, logger }, signal);
  return { fetch, cache, logger, run };
}

const ok = (body: string, etag?: string) => new Response(body, { status: 200, headers: etag ? { ETag: etag } : {} });

describe("fetchCachedCatalogIndex", () => {
  it("returns a fresh body and writes it with its etag", async () => {
    const { run, cache } = setup({ [URL]: ok("{\"a\":1}", "\"v1\"") });
    expect(await run()).toEqual({ body: "{\"a\":1}", fromCache: false });
    expect(cache.writes).toEqual([{ source: "community", index: { body: "{\"a\":1}", etag: "\"v1\"" } }]);
  });

  it("sends If-None-Match and returns the cached body on 304 without rewriting", async () => {
    const { run, cache, fetch } = setup({ [URL]: new Response(null, { status: 304 }) }, { body: "{\"c\":1}", etag: "abc" });
    expect(await run()).toEqual({ body: "{\"c\":1}", fromCache: false });
    expect(fetch.calls[0]!.headers["If-None-Match"]).toBe("abc");
    expect(cache.writes).toEqual([]);
  });

  it("returns the first body when a second call answers 304", async () => {
    const { run } = setup({ [URL]: [ok("{\"first\":1}", "e1"), new Response(null, { status: 304 })] });
    await run();
    expect(await run()).toEqual({ body: "{\"first\":1}", fromCache: false });
  });

  it("falls back to the cache when offline, warning with the url", async () => {
    const { run, logger } = setup({ [URL]: new TypeError("fetch failed") }, { body: "{\"c\":1}" });
    expect(await run()).toEqual({ body: "{\"c\":1}", fromCache: true });
    expect(logger.calls.some((c) => c.level === "WARN" && JSON.stringify(c.context).includes(URL))).toBe(true);
  });

  it("falls back to the cache on HTTP 500, logging url and status", async () => {
    const { run, logger } = setup({ [URL]: new Response("boom", { status: 500 }) }, { body: "{\"c\":1}" });
    expect(await run()).toEqual({ body: "{\"c\":1}", fromCache: true });
    const text = logger.text();
    expect(text).toContain(URL);
    expect(text).toContain("500");
  });

  it("rejects naming the url and status when there is no cache, and logs", async () => {
    const { run, logger } = setup({ [URL]: new Response("boom", { status: 503 }) });
    const error = await run().then(() => undefined, (e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error!.message).toContain(URL);
    expect(error!.message).toContain("503");
    expect(logger.calls.some((c) => c.level === "ERROR" || c.level === "WARN")).toBe(true);
  });

  it("rejects naming the url when offline with no cache", async () => {
    const { run } = setup({ [URL]: new TypeError("fetch failed") });
    await expect(run()).rejects.toThrow(URL);
  });

  it("reads a cached body that accepts rejects as missing: no If-None-Match", async () => {
    const { run, fetch } = setup({ [URL]: ok("{\"fresh\":1}") }, { body: "garbage", etag: "abc" });
    expect(await run()).toEqual({ body: "{\"fresh\":1}", fromCache: false });
    expect(fetch.calls[0]!.headers["If-None-Match"]).toBeUndefined();
  });

  it("does not write a 200 body that accepts rejects, and uses the cache", async () => {
    const { run, cache, logger } = setup({ [URL]: ok("<html>") }, { body: "{\"c\":1}", etag: "abc" });
    expect(await run()).toEqual({ body: "{\"c\":1}", fromCache: true });
    expect(cache.writes).toEqual([]);
    expect(logger.calls.length).toBeGreaterThan(0);
  });

  it("throws on a rejected 200 body when there is no cache", async () => {
    const { run, cache } = setup({ [URL]: ok("<html>") });
    await expect(run()).rejects.toThrow(URL);
    expect(cache.writes).toEqual([]);
  });

  it("rejects on an aborted signal without using the cache", async () => {
    const { run } = setup({ [URL]: ok("{\"x\":1}") }, { body: "{\"c\":1}", etag: "abc" });
    const controller = new AbortController();
    controller.abort();
    await expect(run({}, controller.signal)).rejects.toBeDefined();
  });
});
