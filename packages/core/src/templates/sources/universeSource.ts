/** Lists Typst Universe templates and reads their files from the package archive, unpacked in memory. */
// CONTRACT: documents/contracts/templates.md#typst-universe

import type { ILogger } from "../../ports/index.js";
import { deriveTemplateTreeProblem } from "../templateManifest/index.js";
import type { TemplateEntry } from "../templateEntry.js";
import { fetchCachedCatalogIndex } from "./fetchCachedCatalogIndex.js";
import { fetchCachedThumbnail } from "./fetchCachedThumbnail.js";
import { readTarGz } from "./readTarball.js";
import type { FetchLike, TemplateCache, TemplateFile, TemplateListing, TemplateSource } from "./templateSource.js";
import { UNIVERSE_INDEX_URL, parseUniverseCatalogIndex } from "./universeCatalogIndex.js";

const MODULE = "templates";
const PACKAGES_URL = "https://packages.typst.org/preview";
// Well above any Universe package; it only stops a hostile archive from filling memory.
const MAX_UNPACKED_BYTES = 64 * 1024 * 1024;

export interface UniverseSourceDeps {
  fetch: FetchLike;
  cache: TemplateCache;
  logger: ILogger;
}

/** The files under `templatePath`, relative to it; throws naming the first link or path that breaks a rule. */
async function templateFiles(archive: Uint8Array, templatePath: string): Promise<TemplateFile[]> {
  const prefix = `${templatePath}/`;
  const files: TemplateFile[] = [];
  for (const entry of await readTarGz(archive, MAX_UNPACKED_BYTES)) {
    if (!entry.path.startsWith(prefix)) { continue; }
    const path = entry.path.slice(prefix.length);
    if (entry.kind === "link") { throw new Error(`"${path}" is a link`); }
    if (entry.kind === "file") { files.push({ path, bytes: entry.bytes }); }
  }
  const problem = deriveTemplateTreeProblem(files.map((file) => ({ path: file.path, size: file.bytes.length })));
  if (problem !== undefined) { throw new Error(problem); }
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export function createUniverseSource(deps: UniverseSourceDeps): TemplateSource {
  const templatePaths = new Map<string, string>();

  async function download(entry: TemplateEntry & { version: string }, signal?: AbortSignal): Promise<Uint8Array> {
    const url = `${PACKAGES_URL}/${entry.id}-${entry.version}.tar.gz`;
    const response = await deps.fetch(url, signal ? { signal } : undefined);
    if (!response.ok) { throw new Error(`Could not download ${url} (status ${response.status})`); }
    return new Uint8Array(await response.arrayBuffer());
  }

  return {
    id: "universe",
    async list(signal?: AbortSignal): Promise<TemplateListing> {
      const accepts = (body: string) => parseUniverseCatalogIndex(body).ok;
      const { body, fromCache } = await fetchCachedCatalogIndex({ url: UNIVERSE_INDEX_URL, source: "universe", accepts }, deps, signal);
      const parsed = parseUniverseCatalogIndex(body);
      if (!parsed.ok) { throw new Error(`The Typst Universe index is unusable: ${parsed.reason}`); }
      for (const skipped of parsed.skipped) {
        await deps.logger.log("WARN", MODULE, "Typst Universe template left out", { name: skipped.id, reason: skipped.reason });
      }
      templatePaths.clear();
      for (const { entry, templatePath } of parsed.templates) { templatePaths.set(entry.id, templatePath); }
      return { entries: parsed.templates.map((template) => template.entry), fromCache };
    },
    async thumbnail(entry: TemplateEntry, signal?: AbortSignal): Promise<Uint8Array | undefined> {
      if (entry.version === undefined) { return undefined; }
      const file = `${entry.id}-${entry.version}-small.webp`;
      return fetchCachedThumbnail({ url: `${PACKAGES_URL}/thumbnails/${file}`, key: `universe/${file}` }, deps, signal);
    },
    async files(entry: TemplateEntry, signal?: AbortSignal): Promise<TemplateFile[]> {
      if (!templatePaths.has(entry.id)) { await this.list(signal); }
      const templatePath = templatePaths.get(entry.id);
      const version = entry.version;
      if (templatePath === undefined || version === undefined) {
        throw new Error(`"${entry.id}" is not a Typst Universe template`);
      }
      try {
        return await templateFiles(await download({ ...entry, version }, signal), templatePath);
      } catch (error) {
        await deps.logger.error(MODULE, error, { action: "read Typst Universe template", name: entry.id, version });
        throw error;
      }
    },
  };
}
