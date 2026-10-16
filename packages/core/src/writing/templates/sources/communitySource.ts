/** Lists the Community catalog's templates and downloads their files at the commit the index was built from. */
// CONTRACT: documents/contracts/templates.md#index

import type { ILogger } from "../../../ports/index.js";
import { sha256Hex } from "../../../sync/util/index.js";
import { parseCatalogIndex, type CatalogEntry } from "../catalogIndex.js";
import type { TemplateEntry } from "../templateEntry.js";
import { fetchCachedIndex } from "./fetchCachedIndex.js";
import type { FetchLike, TemplateCache, TemplateFile, TemplateSource } from "./templateSource.js";

const REPOSITORY = "https://cdn.jsdelivr.net/gh/labshelf/labshelf-templates";
export const COMMUNITY_INDEX_URL = `${REPOSITORY}@main/index.json`;
const UPDATING = "The catalog is updating, try again later";
const MODULE = "templates";

export interface CommunitySourceDeps {
  fetch: FetchLike;
  cache: TemplateCache;
  logger: ILogger;
}

interface RememberedIndex {
  commit: string;
  entries: Map<string, CatalogEntry>;
}

function toGalleryEntry(entry: CatalogEntry): TemplateEntry {
  return {
    id: entry.id, name: entry.name, description: entry.description, category: entry.category, format: entry.format,
    engine: entry.engine, main: entry.main, license: entry.license, authors: entry.authors,
    ...(entry.compiler === undefined ? {} : { compiler: entry.compiler }), source: "community",
  };
}

async function download(deps: CommunitySourceDeps, url: string, expected: { size: number; sha256: string }, signal?: AbortSignal): Promise<Uint8Array> {
  const response = await deps.fetch(url, signal ? { signal } : undefined);
  if (!response.ok) {
    await deps.logger.log("ERROR", MODULE, "Template file download failed", { url, status: response.status });
    throw new Error(`Could not download ${url} (status ${response.status})`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length !== expected.size || (await sha256Hex(bytes)) !== expected.sha256) {
    await deps.logger.log("ERROR", MODULE, "Template file does not match the index", { url, size: bytes.length, expectedSize: expected.size });
    throw new Error(UPDATING);
  }
  return bytes;
}

export function createCommunitySource(deps: CommunitySourceDeps): TemplateSource {
  let remembered: RememberedIndex | undefined;

  async function load(signal?: AbortSignal): Promise<RememberedIndex> {
    const accepts = (body: string): boolean => parseCatalogIndex(body).ok;
    const { body } = await fetchCachedIndex({ url: COMMUNITY_INDEX_URL, source: "community", accepts }, deps, signal);
    const parsed = parseCatalogIndex(body);
    // INVARIANT: fetchCachedIndex only returns bodies that accepts() let through.
    if (!parsed.ok) { throw new Error(`The catalog index is unreadable: ${parsed.reason}`); }
    for (const skipped of parsed.skipped) {
      await deps.logger.log("WARN", MODULE, "Community template left out of the gallery", { id: skipped.id, reason: skipped.reason });
    }
    remembered = { commit: parsed.commit, entries: new Map(parsed.entries.map((entry) => [entry.id, entry])) };
    return remembered;
  }

  return {
    id: "community",
    async list(signal) {
      return [...(await load(signal)).entries.values()].map(toGalleryEntry);
    },
    async files(entry, signal) {
      const index = remembered?.entries.has(entry.id) ? remembered : await load(signal);
      const catalogEntry = index.entries.get(entry.id);
      if (catalogEntry === undefined) {
        await deps.logger.log("ERROR", MODULE, "Template is not in the catalog index", { id: entry.id, commit: index.commit });
        throw new Error(UPDATING);
      }
      const files: TemplateFile[] = [];
      for (const file of catalogEntry.files) {
        const url = `${REPOSITORY}@${index.commit}/templates/${entry.id}/files/${file.path}`;
        files.push({ path: file.path, bytes: await download(deps, url, file, signal) });
      }
      return files;
    },
  };
}
