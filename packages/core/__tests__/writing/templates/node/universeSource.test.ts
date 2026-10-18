/** Verifies the Typst Universe source: listing from the index and reading downloaded package templates. */
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { cleanupTempDirs, makeTempDir } from "../../../support/tempDirs";
import { fakeLogger } from "../../../support/fakeLogger";
import { NodeLibraryFileSystem } from "../../../../src/library/node/index.js";
import { createLibraryTemplateCache } from "../../../../src/writing/templates/index.js";
import { createUniverseSource } from "../../../../src/writing/templates/node/index.js";

afterEach(cleanupTempDirs);

const fileCache = (libraryRoot: string) => createLibraryTemplateCache({ fs: new NodeLibraryFileSystem(), paths: path, libraryRoot });

const index = [
  {
    name: "charged-ieee", version: "0.1.3", description: "IEEE paper.", license: "MIT-0", authors: ["Jane Doe"],
    categories: ["paper"], template: { path: "template", entrypoint: "main.typ" },
  },
  { name: "no-template", version: "1.0.0", description: "A library.", license: "MIT", authors: ["X"], categories: [] },
];

type Spec = { namespace: string; name: string; version: string };

async function setup(options: { download?: (spec: Spec, dir: string) => Promise<void>; thumbnail?: Response | Error } = {}) {
  const libraryRoot = await makeTempDir();
  const packageCacheDir = await makeTempDir();
  const logger = fakeLogger();
  const calls: Spec[] = [];
  const download = async (spec: Spec): Promise<void> => {
    calls.push(spec);
    const dir = path.join(packageCacheDir, spec.namespace, spec.name, spec.version);
    if (options.download) { return options.download(spec, dir); }
    await writePackage(dir);
  };
  const requested: string[] = [];
  const fetch = async (url: string) => {
    requested.push(url);
    if (url.endsWith(".webp")) {
      const reply = options.thumbnail ?? new Response("missing", { status: 404 });
      if (reply instanceof Error) { throw reply; }
      return reply.clone();
    }
    return new Response(JSON.stringify(index), { status: 200, headers: { etag: '"v1"' } });
  };
  const source = createUniverseSource({
    fetch, cache: fileCache(libraryRoot), logger, packages: { download }, packageCacheDir,
  });
  return { source, calls, logger, packageCacheDir, requested, libraryRoot };
}

async function writePackage(dir: string): Promise<void> {
  await fs.mkdir(path.join(dir, "template/img"), { recursive: true });
  await fs.writeFile(path.join(dir, "typst.toml"), "[package]\nname = \"charged-ieee\"\n");
  await fs.writeFile(path.join(dir, "lib.typ"), "// library");
  await fs.writeFile(path.join(dir, "template/main.typ"), "= Title");
  await fs.writeFile(path.join(dir, "template/img/fig.png"), Buffer.from([1, 2, 3]));
}

describe("createUniverseSource list", () => {
  it("has id universe and lists templates from the index", async () => {
    const { source } = await setup();
    expect(source.id).toBe("universe");
    const { entries, fromCache } = await source.list();
    expect(fromCache).toBe(false);
    expect(entries[0]!.files).toBeUndefined();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: "charged-ieee", source: "universe", version: "0.1.3", format: "typst", engine: "typst", main: "main.typ", category: "article",
    });
  });
});

describe("createUniverseSource files", () => {
  it("lists first when files() is asked before list()", async () => {
    const { source } = await setup();
    const entry = { ...(await (await setup()).source.list()).entries[0]! };
    const files = await source.files(entry);
    expect(files.map((f) => f.path)).toEqual(["img/fig.png", "main.typ"]);
  });

  it("downloads an absent package and returns only the template files, relative to template.path", async () => {
    const { source, calls } = await setup();
    const [entry] = (await source.list()).entries;
    const files = await source.files(entry!);
    expect(calls).toEqual([{ namespace: "preview", name: "charged-ieee", version: "0.1.3" }]);
    expect(files.map((f) => f.path).sort()).toEqual(["img/fig.png", "main.typ"]);
    expect(Buffer.from(files.find((f) => f.path === "main.typ")!.bytes).toString()).toBe("= Title");
  });

  it("does not download when the package folder is already present", async () => {
    const { source, calls, packageCacheDir } = await setup();
    await writePackage(path.join(packageCacheDir, "preview", "charged-ieee", "0.1.3"));
    const [entry] = (await source.list()).entries;
    const files = await source.files(entry!);
    expect(calls).toEqual([]);
    expect(files).toHaveLength(2);
  });

  it("refuses a package whose template folder holds a symlink, and logs it", async () => {
    const { source, logger } = await setup({
      download: async (_s, dir) => {
        await writePackage(dir);
        await fs.symlink(path.join(dir, "lib.typ"), path.join(dir, "template/alias.typ"));
      },
    });
    const [entry] = (await source.list()).entries;
    await expect(source.files(entry!)).rejects.toThrow(/alias\.typ/);
    expect(logger.logs.length + logger.errors.length).toBeGreaterThan(0);
  });

  it("refuses a symlink that escapes the package with ..", async () => {
    const { source, logger } = await setup({
      download: async (_s, dir) => {
        await writePackage(dir);
        await fs.symlink("../../../../../etc", path.join(dir, "template/escape"));
      },
    });
    const [entry] = (await source.list()).entries;
    await expect(source.files(entry!)).rejects.toThrow(/escape/);
    expect(logger.logs.length + logger.errors.length).toBeGreaterThan(0);
  });

  it("rejects and logs with context when the download fails", async () => {
    const { source, logger } = await setup({ download: async () => { throw new Error("network down"); } });
    const [entry] = (await source.list()).entries;
    await expect(source.files(entry!)).rejects.toThrow();
    const logged = JSON.stringify(logger.logs) + JSON.stringify(logger.errors);
    expect(logger.logs.length + logger.errors.length).toBeGreaterThan(0);
    expect(logged).toContain("charged-ieee");
  });
});

describe("createUniverseSource list freshness", () => {
  it("reports fromCache true when the index fetch fails and the cached index is used", async () => {
    const libraryRoot = await makeTempDir();
    const cache = fileCache(libraryRoot);
    await cache.writeIndex("universe", { body: JSON.stringify(index), etag: '"v1"' });
    const source = createUniverseSource({
      fetch: async () => { throw new Error("offline"); }, cache, logger: fakeLogger(),
      packages: { download: async () => undefined }, packageCacheDir: await makeTempDir(),
    });
    const listed = await source.list();
    expect(listed.fromCache).toBe(true);
    expect(listed.entries.map((e) => e.id)).toEqual(["charged-ieee"]);
  });
});

describe("createUniverseSource thumbnail", () => {
  const WEBP = new Uint8Array([82, 73, 70, 70, 9, 9]);
  const url = "https://packages.typst.org/preview/thumbnails/charged-ieee-0.1.3-small.webp";

  it("fetches the small thumbnail from the Universe base url", async () => {
    const { source, requested } = await setup({ thumbnail: new Response(WEBP) });
    const [entry] = (await source.list()).entries;
    const bytes = await source.thumbnail(entry!);
    expect(Array.from(bytes!)).toEqual(Array.from(WEBP));
    expect(requested).toContain(url);
  });

  it("serves a later call from the cache without fetching", async () => {
    const { source, requested } = await setup({ thumbnail: new Response(WEBP) });
    const [entry] = (await source.list()).entries;
    await source.thumbnail(entry!);
    const before = requested.filter((u) => u === url).length;
    const again = await source.thumbnail(entry!);
    expect(Array.from(again!)).toEqual(Array.from(WEBP));
    expect(requested.filter((u) => u === url).length).toBe(before);
  });

  it("returns undefined and logs WARN when the fetch fails and nothing is cached", async () => {
    const { source, logger } = await setup({ thumbnail: new Error("offline") });
    const [entry] = (await source.list()).entries;
    expect(await source.thumbnail(entry!)).toBeUndefined();
    expect(logger.logs.some((l) => l.level === "WARN")).toBe(true);
  });
});
