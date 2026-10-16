/** Stores the last received template index and the fetched thumbnails of each remote source under the library's .research folder. */
// CONTRACT: documents/contracts/templates.md#cache

import * as fs from "node:fs";
import * as path from "node:path";

import type { CachedIndex, CachedSourceId, TemplateCache } from "../sources/index.js";
import { readOptionalFile } from "./readOptionalFile.js";

const SEGMENT = /^[^/\\\0]+$/;

export function createFsTemplateCache(libraryRoot: string): TemplateCache {
  const root = path.join(libraryRoot, ".research", "templates");
  const folder = (source: CachedSourceId) => path.join(root, source);

  // Keys are "<source>/<file>"; anything else could point outside <source>/thumbnails.
  function thumbnailFile(key: string): string {
    const parts = key.split("/");
    const [source, file] = parts;
    const plain = (segment: string | undefined): segment is string => segment !== undefined && SEGMENT.test(segment) && segment !== "." && segment !== "..";
    if (parts.length !== 2 || !plain(source) || !plain(file)) { throw new Error(`"${key}" is not a thumbnail cache key`); }
    return path.join(root, source, "thumbnails", file);
  }

  return {
    async readIndex(source: CachedSourceId): Promise<CachedIndex | undefined> {
      const body = await readOptionalFile(path.join(folder(source), "index.json"));
      if (body === undefined) { return undefined; }
      const etag = await readOptionalFile(path.join(folder(source), "index.etag"));
      return etag === undefined ? { body: body.toString("utf8") } : { body: body.toString("utf8"), etag: etag.toString("utf8").trim() };
    },
    async writeIndex(source: CachedSourceId, index: CachedIndex): Promise<void> {
      const dir = folder(source);
      await fs.promises.mkdir(dir, { recursive: true });
      await fs.promises.writeFile(path.join(dir, "index.json"), index.body, "utf8");
      const etagFile = path.join(dir, "index.etag");
      if (index.etag === undefined) { await fs.promises.rm(etagFile, { force: true }); }
      else { await fs.promises.writeFile(etagFile, index.etag, "utf8"); }
    },
    async readThumbnail(key: string): Promise<Uint8Array | undefined> {
      const bytes = await readOptionalFile(thumbnailFile(key));
      return bytes === undefined ? undefined : new Uint8Array(bytes);
    },
    async writeThumbnail(key: string, bytes: Uint8Array): Promise<void> {
      const file = thumbnailFile(key);
      await fs.promises.mkdir(path.dirname(file), { recursive: true });
      await fs.promises.writeFile(file, bytes);
    },
  };
}
