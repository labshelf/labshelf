/** Verifies the on-disk template index cache under .research/templates. */
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { cleanupTempDirs, makeTempDir, pathExists } from "../../../support/tempDirs";
import { createFsTemplateCache } from "../../../../src/writing/templates/node/index.js";

afterEach(cleanupTempDirs);

describe("createFsTemplateCache", () => {
  it("reads undefined from an empty library", async () => {
    const cache = createFsTemplateCache(await makeTempDir());
    expect(await cache.readIndex("community")).toBeUndefined();
    expect(await cache.readIndex("universe")).toBeUndefined();
  });

  it("writes the body byte for byte and the etag, and reads both back", async () => {
    const lib = await makeTempDir();
    const cache = createFsTemplateCache(lib);
    const body = '{ "a":1 ,\n"é": "ü" }\n';
    await cache.writeIndex("community", { body, etag: '"abc"' });
    const dir = path.join(lib, ".research", "templates", "community");
    expect(await fs.readFile(path.join(dir, "index.json"), "utf8")).toBe(body);
    expect((await fs.readFile(path.join(dir, "index.etag"), "utf8")).trim()).toBe('"abc"');
    expect(await cache.readIndex("community")).toEqual({ body, etag: '"abc"' });
  });

  it("drops an older etag when written without one", async () => {
    const lib = await makeTempDir();
    const cache = createFsTemplateCache(lib);
    await cache.writeIndex("community", { body: "[1]", etag: "e1" });
    await cache.writeIndex("community", { body: "[2]" });
    const read = await cache.readIndex("community");
    expect(read?.body).toBe("[2]");
    expect(read?.etag).toBeUndefined();
    expect(await pathExists(path.join(lib, ".research/templates/community/index.etag"))).toBe(false);
  });

  it("keeps universe in its own folder", async () => {
    const lib = await makeTempDir();
    const cache = createFsTemplateCache(lib);
    await cache.writeIndex("universe", { body: "[\"u\"]", etag: "eu" });
    expect(await cache.readIndex("community")).toBeUndefined();
    expect(await fs.readFile(path.join(lib, ".research/templates/universe/index.json"), "utf8")).toBe("[\"u\"]");
    expect(await cache.readIndex("universe")).toEqual({ body: "[\"u\"]", etag: "eu" });
  });
});
