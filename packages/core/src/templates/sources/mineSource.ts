/** Lists the user's own templates from <library>/templates and reads their files, and builds the gallery's three sources and the index cache over one library folder. */

import type { ILogger, FetchLike, LibraryFileSystem } from "../../ports/index.js";
import type { PathOps } from "../../path/index.js";
import type { TemplateEntry, TemplateSourceId } from "../templateCatalog.js";
import { comparePaths, parseTemplateManifest, deriveTemplatePathProblem, deriveTemplateTreeProblem } from "../templateManifest/index.js";
import { createCommunitySource, type CachedCatalogIndex, type CachedSourceId, type TemplateCache, type TemplateFile, type TemplateListing, type TemplateSource } from "./communitySource.js";
import { createUniverseSource } from "./universeSource.js";

/** Reads a file's bytes through the library file-system port, or returns undefined when it is not a file. */
export async function readOptionalBytes(fs: LibraryFileSystem, file: string): Promise<Uint8Array | undefined> {
  const stat = await fs.stat(file);
  return stat?.isFile === true ? fs.readFile(file) : undefined;
}

// CONTRACT: documents/contracts/templates.md#cache
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
    async readIndex(source: CachedSourceId): Promise<CachedCatalogIndex | undefined> {
      const body = await readOptionalBytes(fs, paths.join(folder(source), "index.json"));
      if (body === undefined) { return undefined; }
      const etag = await readOptionalBytes(fs, paths.join(folder(source), "index.etag"));
      return etag === undefined ? { body: text.decode(body) } : { body: text.decode(body), etag: text.decode(etag).trim() };
    },
    async writeIndex(source: CachedSourceId, index: CachedCatalogIndex): Promise<void> {
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

// CONTRACT: documents/contracts/templates.md#my-templates
interface LibraryFile {
  /** Relative to the walked folder, segments joined by `/`. */
  path: string;
  absolute: string;
  size: number;
}

// TRAP: a library stat reports a symbolic link as neither file nor folder, so this walk is the only guard between a tree and the files it points at.
async function walk(fs: LibraryFileSystem, paths: PathOps, directory: string, relative: string, found: LibraryFile[]): Promise<void> {
  for (const name of await fs.listDir(directory)) {
    const rel = relative === "" ? name : `${relative}/${name}`;
    const absolute = paths.join(directory, name);
    const stat = await fs.stat(absolute);
    if (stat?.isDirectory === true) { await walk(fs, paths, absolute, rel, found); continue; }
    if (stat?.isFile !== true) { throw new Error(`"${rel}" is not a regular file`); }
    found.push({ path: rel, absolute, size: stat.size });
  }
}

/** The folder's files sorted by relative path; throws naming the path of the first symbolic link or special file. */
async function walkLibraryFolder(fs: LibraryFileSystem, paths: PathOps, folder: string): Promise<LibraryFile[]> {
  if ((await fs.stat(folder))?.isDirectory !== true) { throw new Error(`${folder} is not a folder`); }
  const found: LibraryFile[] = [];
  await walk(fs, paths, folder, "", found);
  return found.sort((a, b) => comparePaths(a.path, b.path));
}

/** The folder's files sorted by their `/`-joined relative path; throws naming the path of the first one that breaks a rule. */
async function readLibraryTemplateTree(fs: LibraryFileSystem, paths: PathOps, folder: string): Promise<TemplateFile[]> {
  const found = await walkLibraryFolder(fs, paths, folder);
  const problem = deriveTemplateTreeProblem(found);
  if (problem !== undefined) { throw new Error(problem); }
  return Promise.all(found.map(async (file) => ({ path: file.path, bytes: await fs.readFile(file.absolute) })));
}

const MODULE = "templates";

export interface MineSourceDeps {
  fs: LibraryFileSystem;
  paths: PathOps;
  libraryRoot: string;
  logger: ILogger;
}

async function listFilePaths({ fs, paths, logger }: MineSourceDeps, folder: string): Promise<string[] | undefined> {
  if (await fs.stat(folder) === undefined) { return undefined; }
  try {
    return (await walkLibraryFolder(fs, paths, folder)).map((file) => file.path);
  } catch (error) {
    await logger.error(MODULE, error, { action: "list My template files", folder });
    return undefined;
  }
}

export function createMineSource(deps: MineSourceDeps): TemplateSource {
  const { fs, paths, libraryRoot, logger } = deps;
  const templatesDir = paths.join(libraryRoot, "templates");

  async function readEntry(folderName: string): Promise<TemplateEntry | undefined> {
    const bytes = await readOptionalBytes(fs, paths.join(templatesDir, folderName, "template.yaml"));
    if (bytes === undefined) { return undefined; }
    const parsed = parseTemplateManifest(new TextDecoder().decode(bytes));
    const reason = !parsed.ok ? parsed.reason : parsed.manifest.id !== folderName ? `id "${parsed.manifest.id}" differs from the folder name` : undefined;
    if (!parsed.ok || reason !== undefined) {
      await logger.error(MODULE, new Error(`My template left out: ${reason}`), { folder: folderName });
      return undefined;
    }
    const files = await listFilePaths(deps, paths.join(templatesDir, folderName, "files"));
    return { ...parsed.manifest, source: "mine", ...(files === undefined ? {} : { files }) };
  }

  // The id becomes a folder name, so anything but a plain segment could leave <library>/templates.
  const plainId = (id: string): boolean => !id.includes("/") && deriveTemplatePathProblem(id) === undefined;

  return {
    id: "mine",
    async list(): Promise<TemplateListing> {
      const entries: TemplateEntry[] = [];
      for (const name of (await fs.listDir(templatesDir)).sort()) {
        const entry = await readEntry(name);
        if (entry !== undefined) { entries.push(entry); }
      }
      return { entries, fromCache: false };
    },
    async thumbnail(entry: TemplateEntry): Promise<Uint8Array | undefined> {
      if (!plainId(entry.id)) { return undefined; }
      return readOptionalBytes(fs, paths.join(templatesDir, entry.id, "preview", "thumbnail.png"));
    },
    async files(entry: TemplateEntry): Promise<TemplateFile[]> {
      if (!plainId(entry.id)) { throw new Error(`"${entry.id}" is not a template id`); }
      try {
        return await readLibraryTemplateTree(fs, paths, paths.join(templatesDir, entry.id, "files"));
      } catch (error) {
        await logger.error(MODULE, error, { action: "read My template", id: entry.id });
        throw error;
      }
    },
  };
}

export interface LibraryTemplateSourcesDeps extends LibraryTemplateCacheDeps {
  fetch: FetchLike;
  logger: ILogger;
}

export function createLibraryTemplateSources(deps: LibraryTemplateSourcesDeps): Record<TemplateSourceId, TemplateSource> {
  const { fetch, logger } = deps;
  const cache = createLibraryTemplateCache(deps);
  return {
    community: createCommunitySource({ fetch, cache, logger }),
    universe: createUniverseSource({ fetch, cache, logger }),
    mine: createMineSource(deps),
  };
}
