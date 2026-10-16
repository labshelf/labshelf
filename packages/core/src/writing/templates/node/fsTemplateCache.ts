/** Stores the last received template index of each remote source under the library's .research folder. */
// CONTRACT: documents/contracts/templates.md#cache

import * as fs from "node:fs";
import * as path from "node:path";

import type { CachedIndex, CachedSourceId, TemplateCache } from "../sources/index.js";

async function readOptional(file: string): Promise<string | undefined> {
  try {
    return await fs.promises.readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") { return undefined; }
    throw error;
  }
}

export function createFsTemplateCache(libraryRoot: string): TemplateCache {
  const folder = (source: CachedSourceId) => path.join(libraryRoot, ".research", "templates", source);
  return {
    async readIndex(source: CachedSourceId): Promise<CachedIndex | undefined> {
      const body = await readOptional(path.join(folder(source), "index.json"));
      if (body === undefined) { return undefined; }
      const etag = await readOptional(path.join(folder(source), "index.etag"));
      return etag === undefined ? { body } : { body, etag: etag.trim() };
    },
    async writeIndex(source: CachedSourceId, index: CachedIndex): Promise<void> {
      const dir = folder(source);
      await fs.promises.mkdir(dir, { recursive: true });
      await fs.promises.writeFile(path.join(dir, "index.json"), index.body, "utf8");
      const etagFile = path.join(dir, "index.etag");
      if (index.etag === undefined) { await fs.promises.rm(etagFile, { force: true }); }
      else { await fs.promises.writeFile(etagFile, index.etag, "utf8"); }
    },
  };
}
