/** Lists Typst Universe templates and reads their files from the downloaded package in the Typst package cache. */
// CONTRACT: documents/contracts/templates.md#typst-universe

import * as fs from "node:fs";
import * as path from "node:path";

import type { ILogger } from "../../../ports/index.js";
import type { TemplateEntry } from "../templateEntry.js";
import { UNIVERSE_INDEX_URL, fetchCachedIndex, parseUniverseIndex } from "../sources/index.js";
import type { FetchLike, TemplateCache, TemplateFile, TemplateSource } from "../sources/index.js";
import { readTemplateTree } from "./readTemplateTree.js";

const MODULE = "templates";
const NAMESPACE = "preview";

type PackageSpec = { namespace: string; name: string; version: string };

export interface UniverseSourceDeps {
  fetch: FetchLike;
  cache: TemplateCache;
  logger: ILogger;
  packages: { download(spec: PackageSpec, fetch: FetchLike, signal?: AbortSignal): Promise<void> };
  /** The Typst package cache folder, shared with the Typst CLI and the build. */
  packageCacheDir: string;
}

async function isFolder(folder: string): Promise<boolean> {
  return fs.promises.stat(folder).then((stat) => stat.isDirectory(), () => false);
}

export function createUniverseSource(deps: UniverseSourceDeps): TemplateSource {
  const templatePaths = new Map<string, string>();

  async function ensurePackage(spec: PackageSpec, folder: string, signal?: AbortSignal): Promise<void> {
    if (await isFolder(folder)) { return; }
    try {
      await deps.packages.download(spec, deps.fetch, signal);
    } catch (error) {
      await deps.logger.error(MODULE, error, { action: "download Typst Universe package", name: spec.name, version: spec.version });
      throw error;
    }
  }

  return {
    id: "universe",
    async list(signal?: AbortSignal): Promise<TemplateEntry[]> {
      const accepts = (body: string) => parseUniverseIndex(body).ok;
      const { body } = await fetchCachedIndex({ url: UNIVERSE_INDEX_URL, source: "universe", accepts }, deps, signal);
      const parsed = parseUniverseIndex(body);
      if (!parsed.ok) { throw new Error(`The Typst Universe index is unusable: ${parsed.reason}`); }
      for (const skipped of parsed.skipped) {
        await deps.logger.log("WARN", MODULE, "Typst Universe template left out", { name: skipped.id, reason: skipped.reason });
      }
      templatePaths.clear();
      for (const { entry, templatePath } of parsed.templates) { templatePaths.set(entry.id, templatePath); }
      return parsed.templates.map((template) => template.entry);
    },
    async files(entry: TemplateEntry, signal?: AbortSignal): Promise<TemplateFile[]> {
      if (!templatePaths.has(entry.id)) { await this.list(signal); }
      const templatePath = templatePaths.get(entry.id);
      if (templatePath === undefined || entry.version === undefined) {
        throw new Error(`"${entry.id}" is not a Typst Universe template`);
      }
      const spec = { namespace: NAMESPACE, name: entry.id, version: entry.version };
      const folder = path.join(deps.packageCacheDir, NAMESPACE, entry.id, entry.version);
      await ensurePackage(spec, folder, signal);
      try {
        return await readTemplateTree(path.join(folder, ...templatePath.split("/")));
      } catch (error) {
        await deps.logger.error(MODULE, error, { action: "read Typst Universe template", name: entry.id, version: entry.version });
        throw error;
      }
    },
  };
}
