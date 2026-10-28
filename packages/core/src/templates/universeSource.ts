/** Lists Typst Universe templates, maps its package index to gallery entries and reads their files from the package archive, unpacked in memory. */

import type { ILogger, FetchLike } from "../ports/index.js";
import { joinBytes } from "../encoding/index.js";
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

// Unpacks a .tar.gz archive in memory into its entries, so any runtime can read a downloaded package without a disk.

const BLOCK = 512;
// TRAP: created per call, because jsdom test environments that load this module have no TextDecoder.
const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

export interface TarEntry {
  /** `/`-joined, without a leading `./`. */
  path: string;
  /** A link is reported, never followed, so the caller can refuse it. */
  kind: "file" | "directory" | "link" | "other";
  bytes: Uint8Array;
}

/** Decompresses at most `maxBytes`; a larger archive throws before it fills memory. */
async function gunzip(archive: Uint8Array, maxBytes: number): Promise<Uint8Array> {
  // slice() narrows the buffer to ArrayBuffer, which Blob requires.
  const stream = new Blob([archive.slice()]).stream().pipeThrough(new DecompressionStream("gzip"));
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
    total += chunk.length;
    if (total > maxBytes) { throw new Error(`The archive unpacks to more than ${maxBytes} bytes`); }
    chunks.push(chunk);
  }
  return joinBytes(chunks);
}

const readText = (block: Uint8Array, start: number, length: number): string => {
  const field = block.subarray(start, start + length);
  const end = field.indexOf(0);
  return decode(end === -1 ? field : field.subarray(0, end));
};

function octal(block: Uint8Array, start: number, length: number): number {
  const value = Number.parseInt(readText(block, start, length).trim() || "0", 8);
  if (!Number.isSafeInteger(value) || value < 0) { throw new Error("The archive has an unreadable entry size"); }
  return value;
}

/** The `path` record of a pax header, which overrides the next entry's name. */
function paxPath(body: Uint8Array): string | undefined {
  for (const record of decode(body).split("\n")) {
    const match = /^\d+ path=(.*)$/.exec(record);
    if (match) { return match[1]; }
  }
  return undefined;
}

function kindOf(type: string): TarEntry["kind"] {
  if (type === "0" || type === "" || type === "7") { return "file"; }
  if (type === "5") { return "directory"; }
  if (type === "1" || type === "2") { return "link"; }
  return "other";
}

export async function readTarGz(archive: Uint8Array, maxBytes: number): Promise<TarEntry[]> {
  const tar = await gunzip(archive, maxBytes);
  const entries: TarEntry[] = [];
  let longName: string | undefined;
  for (let offset = 0; offset + BLOCK <= tar.length;) {
    const header = tar.subarray(offset, offset + BLOCK);
    if (header.every((byte) => byte === 0)) { break; }
    const size = octal(header, 124, 12);
    const type = readText(header, 156, 1);
    const start = offset + BLOCK;
    if (start + size > tar.length) { throw new Error("The archive ends inside an entry"); }
    const body = tar.subarray(start, start + size);
    offset = start + Math.ceil(size / BLOCK) * BLOCK;
    // GNU long names and pax headers carry the name of the entry that follows them.
    if (type === "L") { longName = readText(body, 0, body.length); continue; }
    if (type === "x") { longName = paxPath(body) ?? longName; continue; }
    if (type === "g") { continue; }
    const prefix = readText(header, 345, 155);
    const name = longName ?? (prefix ? `${prefix}/${readText(header, 0, 100)}` : readText(header, 0, 100));
    longName = undefined;
    entries.push({ path: name.replace(/^(\.\/)+/, "").replace(/\/+$/, ""), kind: kindOf(type), bytes: body });
  }
  return entries;
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
