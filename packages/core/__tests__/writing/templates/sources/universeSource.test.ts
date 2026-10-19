/** Verifies the Typst Universe source: listing from the index and reading a template from the package archive. */
import { createUniverseSource } from "../../../../src/writing/templates/sources/index.js";
import { contextLogger, memoryCache } from "./fakes";
import { tarGz, type TarFixtureEntry } from "./tarFixture";

const index = [
  {
    name: "charged-ieee", version: "0.1.3", description: "IEEE paper.", license: "MIT-0", authors: ["Jane Doe"],
    categories: ["paper"], template: { path: "template", entrypoint: "main.typ" },
  },
  { name: "no-template", version: "1.0.0", description: "A library.", license: "MIT", authors: ["X"], categories: [] },
];

const PACKAGE_URL = "https://packages.typst.org/preview/charged-ieee-0.1.3.tar.gz";
const THUMBNAIL_URL = "https://packages.typst.org/preview/thumbnails/charged-ieee-0.1.3-small.webp";

const packageEntries: TarFixtureEntry[] = [
  { name: "./", type: "5" },
  { name: "./typst.toml", body: "[package]\nname = \"charged-ieee\"\n" },
  { name: "./lib.typ", body: "// library" },
  { name: "./template/", type: "5" },
  { name: "./template/main.typ", body: "= Title" },
  { name: "./template/img/fig.png", body: new Uint8Array([1, 2, 3]) },
];

interface SetupOptions {
  archive?: Response | Error;
  thumbnail?: Response | Error;
  indexFails?: boolean;
}

function setup(options: SetupOptions = {}) {
  const logger = contextLogger();
  const cache = memoryCache();
  const requested: string[] = [];
  const reply = (value: Response | Error): Response => { if (value instanceof Error) { throw value; } return value.clone(); };
  const fetch = async (url: string): Promise<Response> => {
    requested.push(url);
    if (url === THUMBNAIL_URL) { return reply(options.thumbnail ?? new Response("missing", { status: 404 })); }
    if (url === PACKAGE_URL) { return reply(options.archive ?? new Response(tarGz(packageEntries))); }
    if (options.indexFails) { throw new Error("offline"); }
    return new Response(JSON.stringify(index), { status: 200, headers: { etag: '"v1"' } });
  };
  return { source: createUniverseSource({ fetch, cache, logger }), cache, logger, requested };
}

describe("createUniverseSource list", () => {
  it("has id universe and lists templates from the index", async () => {
    const { source } = setup();
    expect(source.id).toBe("universe");
    const { entries, fromCache } = await source.list();
    expect(fromCache).toBe(false);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.files).toBeUndefined();
    expect(entries[0]).toMatchObject({
      id: "charged-ieee", source: "universe", version: "0.1.3", format: "typst", engine: "typst", main: "main.typ", category: "article",
    });
  });

  it("reports fromCache true when the index fetch fails and the cached index is used", async () => {
    const { source, cache } = setup({ indexFails: true });
    await cache.writeIndex("universe", { body: JSON.stringify(index), etag: '"v1"' });
    const listed = await source.list();
    expect(listed.fromCache).toBe(true);
    expect(listed.entries.map((e) => e.id)).toEqual(["charged-ieee"]);
  });
});

describe("createUniverseSource files", () => {
  it("returns only the template files, relative to template.path and sorted", async () => {
    const { source, requested } = setup();
    const [entry] = (await source.list()).entries;
    const files = await source.files(entry!);
    expect(requested).toContain(PACKAGE_URL);
    expect(files.map((f) => f.path)).toEqual(["img/fig.png", "main.typ"]);
    expect(Buffer.from(files.find((f) => f.path === "main.typ")!.bytes).toString()).toBe("= Title");
  });

  it("lists first when files() is asked before list()", async () => {
    const entry = (await setup().source.list()).entries[0]!;
    const files = await setup().source.files(entry);
    expect(files.map((f) => f.path)).toEqual(["img/fig.png", "main.typ"]);
  });

  it("refuses a template folder that holds a link, naming it, and logs it", async () => {
    const archive = new Response(tarGz([...packageEntries, { name: "./template/alias.typ", type: "2" }]));
    const { source, logger } = setup({ archive });
    const [entry] = (await source.list()).entries;
    await expect(source.files(entry!)).rejects.toThrow(/alias\.typ/);
    expect(logger.text()).toContain("charged-ieee");
  });

  it("refuses a template path that escapes with ..", async () => {
    const archive = new Response(tarGz([...packageEntries, { name: "template/../../escape.typ", body: "x" }]));
    const { source } = setup({ archive });
    const [entry] = (await source.list()).entries;
    await expect(source.files(entry!)).rejects.toThrow(/escape\.typ/);
  });

  it("rejects and logs with context when the download fails", async () => {
    const { source, logger } = setup({ archive: new Response("gone", { status: 404 }) });
    const [entry] = (await source.list()).entries;
    await expect(source.files(entry!)).rejects.toThrow(/status 404/);
    expect(logger.text()).toContain("charged-ieee");
  });
});

describe("createUniverseSource thumbnail", () => {
  const WEBP = new Uint8Array([82, 73, 70, 70, 9, 9]);

  it("fetches the small thumbnail once and serves later calls from the cache", async () => {
    const { source, requested } = setup({ thumbnail: new Response(WEBP) });
    const [entry] = (await source.list()).entries;
    expect(Array.from((await source.thumbnail(entry!))!)).toEqual(Array.from(WEBP));
    expect(Array.from((await source.thumbnail(entry!))!)).toEqual(Array.from(WEBP));
    expect(requested.filter((u) => u === THUMBNAIL_URL)).toHaveLength(1);
  });

  it("returns undefined and logs WARN when the fetch fails and nothing is cached", async () => {
    const { source, logger } = setup({ thumbnail: new Error("offline") });
    const [entry] = (await source.list()).entries;
    expect(await source.thumbnail(entry!)).toBeUndefined();
    expect(logger.calls.some((c) => c.level === "WARN")).toBe(true);
  });
});
