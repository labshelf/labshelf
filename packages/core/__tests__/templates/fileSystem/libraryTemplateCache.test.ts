/** Verifies the on-disk template index cache under .research/templates. */
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { cleanupTempDirs, makeTempDir, pathExists } from "../../support/tempDirs";
import { NodeLibraryFileSystem } from "../../../src/library/node/index.js";
import { createLibraryTemplateCache } from "../../../src/templates/index.js";

afterEach(cleanupTempDirs);

const nodeCache = (libraryRoot: string) => createLibraryTemplateCache({ fs: new NodeLibraryFileSystem(), paths: path, libraryRoot });

describe("createLibraryTemplateCache", () => {
  it("reads undefined from an empty library", async () => {
    const cache = nodeCache(await makeTempDir());
    expect(await cache.readIndex("community")).toBeUndefined();
    expect(await cache.readIndex("universe")).toBeUndefined();
  });

  it("writes the body byte for byte and the etag, and reads both back", async () => {
    const lib = await makeTempDir();
    const cache = nodeCache(lib);
    const body = '{ "a":1 ,\n"é": "ü" }\n';
    await cache.writeIndex("community", { body, etag: '"abc"' });
    const dir = path.join(lib, ".research", "templates", "community");
    expect(await fs.readFile(path.join(dir, "index.json"), "utf8")).toBe(body);
    expect((await fs.readFile(path.join(dir, "index.etag"), "utf8")).trim()).toBe('"abc"');
    expect(await cache.readIndex("community")).toEqual({ body, etag: '"abc"' });
  });

  it("drops an older etag when written without one", async () => {
    const lib = await makeTempDir();
    const cache = nodeCache(lib);
    await cache.writeIndex("community", { body: "[1]", etag: "e1" });
    await cache.writeIndex("community", { body: "[2]" });
    const read = await cache.readIndex("community");
    expect(read?.body).toBe("[2]");
    expect(read?.etag).toBeUndefined();
    expect(await pathExists(path.join(lib, ".research/templates/community/index.etag"))).toBe(false);
  });

  it("keeps universe in its own folder", async () => {
    const lib = await makeTempDir();
    const cache = nodeCache(lib);
    await cache.writeIndex("universe", { body: "[\"u\"]", etag: "eu" });
    expect(await cache.readIndex("community")).toBeUndefined();
    expect(await fs.readFile(path.join(lib, ".research/templates/universe/index.json"), "utf8")).toBe("[\"u\"]");
    expect(await cache.readIndex("universe")).toEqual({ body: "[\"u\"]", etag: "eu" });
  });

  describe("thumbnails", () => {
    const bytes = new Uint8Array([0, 255, 1, 2]);

    it("reads undefined for a thumbnail never written", async () => {
      expect(await nodeCache(await makeTempDir()).readThumbnail("community/abc.png")).toBeUndefined();
    });

    it("stores bytes under <source>/thumbnails and reads them back", async () => {
      const lib = await makeTempDir();
      const cache = nodeCache(lib);
      await cache.writeThumbnail("universe/charged-0.1.0-small.webp", bytes);
      const file = path.join(lib, ".research/templates/universe/thumbnails/charged-0.1.0-small.webp");
      expect(Array.from(await fs.readFile(file))).toEqual(Array.from(bytes));
      expect(Array.from((await cache.readThumbnail("universe/charged-0.1.0-small.webp"))!)).toEqual(Array.from(bytes));
    });

    it.each(["../escape.png", "community/../../escape.png", "community/../escape.png", "../../../outside"])(
      "cannot write or read outside the thumbnails folder with key %s", async (key) => {
        const lib = await makeTempDir();
        const cache = nodeCache(lib);
        await cache.writeThumbnail(key, bytes).catch(() => undefined);
        expect(await cache.readThumbnail(key).catch(() => undefined)).toBeUndefined();
        const written: string[] = [];
        const walk = async (dir: string): Promise<void> => {
          for (const e of await fs.readdir(dir, { withFileTypes: true })) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) { await walk(full); } else { written.push(full); }
          }
        };
        await walk(lib);
        const allowed = path.join(lib, ".research", "templates");
        expect(written.every((f) => f.startsWith(allowed + path.sep) && f.includes(`${path.sep}thumbnails${path.sep}`))).toBe(true);
      });
  });
});
