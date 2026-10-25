// Stores the last received template index and the fetched thumbnails of each remote source under the library's .research folder.
// CONTRACT: documents/contracts/templates.md#cache
import type { LibraryFileSystem } from "../../ports/index.js";
import type { PathOps } from "../../library/index.js";
import type { CachedIndex, CachedSourceId, TemplateCache } from "../sources/index.js";
import { readOptionalBytes } from "./readOptionalBytes.js";

const SEGMENT = /^[^/\\\0]+$/;

export interface LibraryTemplateCacheDeps {
  fs: LibraryFileSystem;
  paths: PathOps;
  libraryRoot: string;
}

export function createLibraryTemplateCache({ fs, paths, libraryRoot }: LibraryTemplateCacheDeps): TemplateCache {
  const root = paths.join(libraryRoot, ".research", "templates");
  const folder = (source: CachedSourceId) => paths.join(root, source);

  // Keys are "<source>/<file>"; anything else could point outside <source>/thumbnails.
  function thumbnailFile(key: string): string {
    const parts = key.split("/");
    const [source, file] = parts;
    const plain = (segment: string | undefined): segment is string => segment !== undefined && SEGMENT.test(segment) && segment !== "." && segment !== "..";
    if (parts.length !== 2 || !plain(source) || !plain(file)) { throw new Error(`"${key}" is not a thumbnail cache key`); }
    return paths.join(root, source, "thumbnails", file);
  }

  // TRAP: built per cache, not at module load, because the jsdom test environment has no TextDecoder when a gallery test imports this module.
  const text = new TextDecoder();
  return {
    async readIndex(source: CachedSourceId): Promise<CachedIndex | undefined> {
      const body = await readOptionalBytes(fs, paths.join(folder(source), "index.json"));
      if (body === undefined) { return undefined; }
      const etag = await readOptionalBytes(fs, paths.join(folder(source), "index.etag"));
      return etag === undefined ? { body: text.decode(body) } : { body: text.decode(body), etag: text.decode(etag).trim() };
    },
    async writeIndex(source: CachedSourceId, index: CachedIndex): Promise<void> {
      const dir = folder(source);
      await fs.ensureDir(dir);
      await fs.writeText(paths.join(dir, "index.json"), index.body);
      const etagFile = paths.join(dir, "index.etag");
      if (index.etag === undefined) { await fs.deleteFile(etagFile); }
      else { await fs.writeText(etagFile, index.etag); }
    },
    async readThumbnail(key: string): Promise<Uint8Array | undefined> {
      return readOptionalBytes(fs, thumbnailFile(key));
    },
    async writeThumbnail(key: string, bytes: Uint8Array): Promise<void> {
      const file = thumbnailFile(key);
      await fs.ensureDir(paths.dirname(file));
      await fs.writeFile(file, bytes);
    },
  };
}
