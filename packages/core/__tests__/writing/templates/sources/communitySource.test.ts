/** Verifies the Community catalog source: listing from index.json and checked file downloads at the pinned commit. */
import { COMMUNITY_INDEX_URL, createCommunitySource } from "../../../../src/writing/templates/sources/index.js";
import { sha256Hex } from "../../../../src/sync/util/index";
import { contextLogger, memoryCache, scriptedFetch, type Reply } from "./fakes";

const COMMIT = "3f2c".repeat(10);
const SHA = "9b1e".repeat(16);
const enc = new TextEncoder();
const MAIN = enc.encode("\\documentclass{article}");
const REFS = enc.encode("@book{a}");
const base = (id: string) => `https://cdn.jsdelivr.net/gh/labshelf/labshelf-templates@${COMMIT}/templates/${id}/files`;

async function entry(id: string, over: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  return {
    id, name: `Name ${id}`, description: "A template.", category: "article", format: "latex", engine: "pdflatex",
    main: "main.tex", license: "MIT", authors: ["Jane Doe"],
    files: [
      { path: "main.tex", size: MAIN.length, sha256: await sha256Hex(MAIN) },
      { path: "refs/refs.bib", size: REFS.length, sha256: await sha256Hex(REFS) },
    ],
    thumbnail: { size: 1, sha256: SHA }, sample: { size: 1, sha256: SHA }, ...over,
  };
}

const indexText = (templates: unknown[], over: Record<string, unknown> = {}) =>
  JSON.stringify({ schema: 1, commit: COMMIT, templates, ...over });

async function setup(templates: unknown[], files: Record<string, Reply> = {}, cached?: string) {
  const fetch = scriptedFetch({
    [COMMUNITY_INDEX_URL]: new Response(indexText(templates), { status: 200, headers: { ETag: "e1" } }),
    [`${base("a")}/main.tex`]: new Response(MAIN),
    [`${base("a")}/refs/refs.bib`]: new Response(REFS),
    ...files,
  });
  const cache = memoryCache(cached ? { community: { body: cached } } : {});
  const logger = contextLogger();
  return { fetch, cache, logger, source: createCommunitySource({ fetch, cache, logger }) };
}

describe("createCommunitySource list", () => {
  it("uses the jsDelivr @main index url", () => {
    expect(COMMUNITY_INDEX_URL).toBe("https://cdn.jsdelivr.net/gh/labshelf/labshelf-templates@main/index.json");
  });

  it("has id community and lists entries with source community", async () => {
    const { source } = await setup([await entry("a"), await entry("b")]);
    expect(source.id).toBe("community");
    const entries = await source.list();
    expect(entries.map((e) => [e.id, e.source])).toEqual([["a", "community"], ["b", "community"]]);
  });

  it("logs and leaves out invalid and duplicate entries", async () => {
    const { source, logger } = await setup([
      await entry("a"), await entry("bad", { category: "book" }), await entry("a", { name: "Again" }), await entry("c"),
    ]);
    expect((await source.list()).map((e) => e.id)).toEqual(["a", "c"]);
    expect(logger.text()).toContain("bad");
    expect(logger.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("refuses a schema 2 index and lists the cached one", async () => {
    const cached = indexText([await entry("old")]);
    const { source } = await setup([await entry("new")], {
      [COMMUNITY_INDEX_URL]: new Response(indexText([await entry("new")], { schema: 2 }), { status: 200 }),
    }, cached);
    expect((await source.list()).map((e) => e.id)).toEqual(["old"]);
  });
});

describe("createCommunitySource files", () => {
  it("fetches each file at the commit url and returns path and bytes", async () => {
    const { source, fetch } = await setup([await entry("a")]);
    const [listed] = await source.list();
    const files = await source.files(listed!);
    expect(files.map((f) => f.path)).toEqual(["main.tex", "refs/refs.bib"]);
    expect(Array.from(files[0]!.bytes)).toEqual(Array.from(MAIN));
    expect(Array.from(files[1]!.bytes)).toEqual(Array.from(REFS));
    expect(fetch.calls.map((c) => c.url)).toEqual(expect.arrayContaining([`${base("a")}/main.tex`, `${base("a")}/refs/refs.bib`]));
  });

  it("works before list() by listing first", async () => {
    const { source } = await setup([await entry("a")]);
    const entryA = { ...(await entry("a")), source: "community" } as never;
    expect((await source.files(entryA)).map((f) => f.path)).toEqual(["main.tex", "refs/refs.bib"]);
  });

  it("refuses a file whose sha256 differs from the index", async () => {
    const url = `${base("a")}/main.tex`;
    const { source, logger } = await setup([await entry("a")], { [url]: new Response(enc.encode("\\documentclass{book}12")) });
    const [listed] = await source.list();
    await expect(source.files(listed!)).rejects.toThrow("The catalog is updating, try again later");
    expect(logger.text()).toContain(url);
  });

  it("refuses a file whose size differs even when the content matches the index hash", async () => {
    const url = `${base("a")}/main.tex`;
    const { source, logger } = await setup([await entry("a", { files: [
      { path: "main.tex", size: MAIN.length + 1, sha256: await sha256Hex(MAIN) },
    ] })]);
    const [listed] = await source.list();
    await expect(source.files(listed!)).rejects.toThrow("The catalog is updating, try again later");
    expect(logger.text()).toContain(url);
  });

  it("rejects on HTTP 404, logging url and status", async () => {
    const url = `${base("a")}/refs/refs.bib`;
    const { source, logger } = await setup([await entry("a")], { [url]: new Response("gone", { status: 404 }) });
    const [listed] = await source.list();
    await expect(source.files(listed!)).rejects.toBeInstanceOf(Error);
    expect(logger.text()).toContain(url);
    expect(logger.text()).toContain("404");
  });
});
