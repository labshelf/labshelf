/** Lists Typst Universe templates, maps its package index to gallery entries and reads their files from the package archive, unpacked in memory. */

import type { ILogger, FetchLike } from "../ports/index.js";
import { readTarGz } from "../encoding/index.js";
import { isRecord } from "../guards/index.js";
import { parseCatalogIndexJson, comparePaths, deriveTemplatePathProblem, deriveTemplateTreeProblem, type SkippedEntry, type TemplateKind } from "./templateManifest/index.js";
import type { TemplateEntry } from "./templateCatalog.js";
import { fetchCachedCatalogIndex, fetchCachedThumbnail, type TemplateCache, type TemplateFile, type TemplateListing, type TemplateSource } from "./communitySource.js";

// CONTRACT: documents/contracts/templates.md#typst-universe

export const UNIVERSE_INDEX_URL = "https://packages.typst.org/preview/index.json";

export interface UniverseTemplate {
  entry: TemplateEntry;
  /** The folder of the package that holds the template's files. */
  templatePath: string;
}

export type UniverseCatalogIndexResult =
  | { ok: true; templates: UniverseTemplate[]; skipped: SkippedEntry[] }
  | { ok: false; reason: string };

const CATEGORY_MAP: Record<string, TemplateKind> = {
  paper: "article", thesis: "thesis", poster: "poster", presentation: "slides", cv: "cv",
};

/** Whether dotted version `candidate` is higher than `current`, compared as numbers segment by segment. */
export function isNewerVersion(candidate: string, current: string): boolean {
  const a = candidate.split(".").map(Number);
  const b = current.split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const difference = (a[i] ?? 0) - (b[i] ?? 0);
    if (difference !== 0) { return difference > 0; }
  }
  return false;
}

function categoryOf(categories: unknown): TemplateKind {
  const list = Array.isArray(categories) ? categories : [];
  for (const category of list) {
    const mapped = typeof category === "string" ? CATEGORY_MAP[category] : undefined;
    if (mapped !== undefined) { return mapped; }
  }
  return "other";
}

function authorsOf(authors: unknown): string[] {
  if (!Array.isArray(authors)) { return []; }
  return authors.filter((a): a is string => typeof a === "string").map((a) => a.replace(/\s*<[^>]*>\s*$/, "").trim());
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

type Mapped = { value: UniverseTemplate } | { problem: string };

function mapPackage(pkg: Record<string, unknown>, template: Record<string, unknown>): Mapped {
  const name = text(pkg["name"]);
  const version = text(pkg["version"]);
  const templatePath = text(template["path"]);
  const main = text(template["entrypoint"]);
  if (name === undefined || version === undefined) { return { problem: "name and version are required" }; }
  if (templatePath === undefined || main === undefined) { return { problem: "template.path and template.entrypoint are required" }; }
  const problem = deriveTemplatePathProblem(templatePath) ?? deriveTemplatePathProblem(main);
  if (problem !== undefined) { return { problem: `template: ${problem}` }; }
  const compiler = text(pkg["compiler"]);
  const entry: TemplateEntry = {
    id: name, name, version, description: text(pkg["description"]) ?? "", category: categoryOf(pkg["categories"]),
    format: "typst", engine: "typst", main, license: text(pkg["license"]) ?? "NOASSERTION", authors: authorsOf(pkg["authors"]),
    ...(compiler === undefined ? {} : { compiler }), source: "universe",
  };
  return { value: { entry, templatePath } };
}

/** Reads Universe's index.json; never throws. Packages without a template key are ignored, unsafe template paths are skipped. */
export function parseUniverseCatalogIndex(jsonText: string): UniverseCatalogIndexResult {
  const json = parseCatalogIndexJson(jsonText);
  if (!json.ok) { return json; }
  const value = json.value;
  if (!Array.isArray(value)) { return { ok: false, reason: "index.json is not an array" }; }
  const latest = new Map<string, Record<string, unknown>>();
  for (const pkg of value) {
    if (!isRecord(pkg) || !isRecord(pkg["template"])) { continue; }
    const name = text(pkg["name"]);
    const version = text(pkg["version"]);
    if (name === undefined || version === undefined) { continue; }
    const seen = latest.get(name);
    if (seen === undefined || isNewerVersion(version, String(seen["version"]))) { latest.set(name, pkg); }
  }
  const templates: UniverseTemplate[] = [];
  const skipped: SkippedEntry[] = [];
  for (const [name, pkg] of latest) {
    const mapped = mapPackage(pkg, pkg["template"] as Record<string, unknown>);
    if ("problem" in mapped) { skipped.push({ id: name, reason: mapped.problem }); } else { templates.push(mapped.value); }
  }
  return { ok: true, templates, skipped };
}

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
  return files.sort((a, b) => comparePaths(a.path, b.path));
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
