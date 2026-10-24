/** Verifies the jsDelivr download count: summing across versions, main-file matching, pagination and failures. */
import { countDownloads } from "../../src/templates/countDownloads.js";
import type { FetchLike } from "../../src/templates/index";

const BASE = "https://data.jsdelivr.com/v1/stats/packages/gh/labshelf/labshelf-templates";
const query = (page: number) => `period=year&limit=100&page=${page}`;
const versionsUrl = (page: number) => `${BASE}/versions?${query(page)}`;
const filesUrl = (version: string, page: number) => `${BASE}@${version}/files?${query(page)}`;

const version = (name: string, total: number) => ({ type: "version", version: name, hits: { total } });
const file = (name: string, total: number) => ({ name, hits: { total, dates: {} } });

/** Serves canned pages by URL; every page of a route list carries the route's total page count. */
function fakeFetch(routes: Record<string, unknown[][]>, calls: string[] = []): FetchLike {
  return async (url) => {
    calls.push(url);
    const [path = "", search = ""] = url.split("?");
    const page = Number(new URLSearchParams(search).get("page"));
    const pages = routes[path];
    if (pages === undefined || pages[page - 1] === undefined) return new Response("not found", { status: 404 });
    const headers = { "x-total-pages": String(pages.length), "x-total-count": String(pages.flat().length) };
    return new Response(JSON.stringify(pages[page - 1]), { status: 200, headers });
  };
}

const templates = [{ id: "beta", main: "main.tex" }, { id: "alpha", main: "main.typ" }, { id: "idle", main: "main.tex" }];

describe("countDownloads", () => {
  it("sums the main file's hits across versions and sorts keys by id", async () => {
    const fetch = fakeFetch({
      [`${BASE}/versions`]: [[version("aaa", 5), version("bbb", 7)]],
      [`${BASE}@aaa/files`]: [[file("/templates/beta/files/main.tex", 3), file("/templates/alpha/files/main.typ", 2)]],
      [`${BASE}@bbb/files`]: [[file("/templates/beta/files/main.tex", 4)]],
    });
    const result = await countDownloads(templates, fetch);
    expect(result).toEqual({ alpha: 2, beta: 7, idle: 0 });
    expect(Object.keys(result)).toEqual(["alpha", "beta", "idle"]);
  });

  it("ignores thumbnails and files other than the main file", async () => {
    const fetch = fakeFetch({
      [`${BASE}/versions`]: [[version("aaa", 9)]],
      [`${BASE}@aaa/files`]: [[
        file("/templates/beta/preview/thumbnail.png", 50),
        file("/templates/beta/files/refs.bib", 40),
        file("/templates/beta/files/sub/main.tex", 30),
        file("/templates/beta/template.yaml", 20),
        file("/templates/beta/files/main.tex", 1),
      ]],
    });
    expect(await countDownloads([{ id: "beta", main: "main.tex" }], fetch)).toEqual({ beta: 1 });
  });

  it("reads every page of versions and files", async () => {
    const calls: string[] = [];
    const fetch = fakeFetch({
      [`${BASE}/versions`]: [[version("aaa", 1)], [version("bbb", 1)]],
      [`${BASE}@aaa/files`]: [[file("/templates/beta/files/main.tex", 1)], [file("/templates/beta/files/main.tex", 2)]],
      [`${BASE}@bbb/files`]: [[file("/templates/beta/files/main.tex", 4)]],
    }, calls);
    expect(await countDownloads([{ id: "beta", main: "main.tex" }], fetch)).toEqual({ beta: 7 });
    expect(calls).toContain(versionsUrl(2));
    expect(calls).toContain(filesUrl("aaa", 2));
  });

  it("skips versions without hits", async () => {
    const calls: string[] = [];
    const fetch = fakeFetch({
      [`${BASE}/versions`]: [[version("aaa", 0), version("bbb", 2)]],
      [`${BASE}@bbb/files`]: [[file("/templates/beta/files/main.tex", 2)]],
    }, calls);
    expect(await countDownloads([{ id: "beta", main: "main.tex" }], fetch)).toEqual({ beta: 2 });
    expect(calls.some((url) => url.includes("@aaa"))).toBe(false);
  });

  it("throws an error carrying the URL and status on a non-OK response", async () => {
    const fetch: FetchLike = async () => new Response("boom", { status: 500 });
    await expect(countDownloads(templates, fetch)).rejects.toThrow(`${versionsUrl(1)} 500`);
  });

  it("throws when a files page fails", async () => {
    const good = fakeFetch({ [`${BASE}/versions`]: [[version("aaa", 1)]] });
    const fetch: FetchLike = async (url, init) =>
      url.includes("@aaa") ? new Response("boom", { status: 500 }) : good(url, init);
    await expect(countDownloads(templates, fetch)).rejects.toThrow(`${filesUrl("aaa", 1)} 500`);
  });
});
