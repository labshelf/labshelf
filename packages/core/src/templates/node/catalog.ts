/** Reads a community catalog checkout: validates every template folder, builds its index.json, and checks the preview files against the size limits. */
// CONTRACT: documents/contracts/templates.md#community-catalog

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { parseTemplateManifest, isDownloadCount, type CatalogAsset, type CatalogEntry } from "../templateManifest/index.js";
import { readTemplateTree } from "./templateFolder.js";
import { formatError } from "../../errors/index.js";

const KIB = 1024;

export const THUMBNAIL_MAX_BYTES = 512 * KIB;
const THUMBNAIL_MIN_WIDTH = 400;
const THUMBNAIL_MAX_WIDTH = 1600;
export const SAMPLE_MAX_BYTES = 10 * KIB * KIB;

export interface CatalogProblem { id: string; reason: string }
interface LoadedCatalog { entries: CatalogEntry[]; problems: CatalogProblem[] }
type Previews = { thumbnail: Uint8Array; sample: Uint8Array };
type Read<T> = { value: T } | { problem: string };

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const IHDR = [0x49, 0x48, 0x44, 0x52];
const WIDTH_OFFSET = 16;

/** The width in pixels, or undefined when the bytes do not start with a PNG signature and an IHDR chunk. */
export function readPngWidth(bytes: Uint8Array): number | undefined {
  if (bytes.length < WIDTH_OFFSET + 4) { return undefined; }
  const isPng = SIGNATURE.every((byte, i) => bytes[i] === byte) && IHDR.every((byte, i) => bytes[12 + i] === byte);
  return isPng ? new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(WIDTH_OFFSET) : undefined;
}

/** The reason the bytes cannot be a catalog thumbnail, or undefined when the width fits. */
export function deriveThumbnailProblem(bytes: Uint8Array): string | undefined {
  const width = readPngWidth(bytes);
  if (width === undefined) { return "thumbnail.png is not a PNG"; }
  const inRange = width >= THUMBNAIL_MIN_WIDTH && width <= THUMBNAIL_MAX_WIDTH;
  return inRange ? undefined : `thumbnail.png is ${width} pixels wide, not ${THUMBNAIL_MIN_WIDTH} to ${THUMBNAIL_MAX_WIDTH}`;
}

/** A regular file's bytes, or the reason it cannot be used; a symbolic link is refused. */
async function readRegularFile(folder: string, name: string, maxBytes: number): Promise<Read<Uint8Array>> {
  const file = path.join(folder, name);
  const stat = await fs.promises.lstat(file).catch(() => undefined);
  if (stat === undefined) { return { problem: `${name} is missing` }; }
  if (!stat.isFile()) { return { problem: `${name} is not a regular file` }; }
  if (stat.size > maxBytes) { return { problem: `${name} is over ${maxBytes} bytes` }; }
  return { value: new Uint8Array(await fs.promises.readFile(file)) };
}

/** The two preview files of a template's preview folder, or a reason naming the one that fails. */
async function readPreviews(previewFolder: string): Promise<Read<Previews>> {
  const thumbnail = await readRegularFile(previewFolder, "thumbnail.png", THUMBNAIL_MAX_BYTES);
  if ("problem" in thumbnail) { return { problem: `thumbnail: ${thumbnail.problem}` }; }
  const problem = deriveThumbnailProblem(thumbnail.value);
  if (problem !== undefined) { return { problem: `thumbnail: ${problem}` }; }
  const sample = await readRegularFile(previewFolder, "sample.pdf", SAMPLE_MAX_BYTES);
  if ("problem" in sample) { return { problem: `sample: ${sample.problem}` }; }
  const isPdf = new TextDecoder("latin1").decode(sample.value.subarray(0, 5)) === "%PDF-";
  return isPdf ? { value: { thumbnail: thumbnail.value, sample: sample.value } } : { problem: "sample: sample.pdf is not a PDF" };
}

/** Counts by template id, or an empty map when `<root>/downloads.json` is missing (a scheduled CI job writes it); throws naming the file when it is invalid. */
async function readDownloadCounts(root: string): Promise<Map<string, number>> {
  const file = path.join(root, "downloads.json");
  const text = await fs.promises.readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") { return undefined; }
    throw new Error(`downloads.json: cannot be read (${error.message})`);
  });
  if (text === undefined) { return new Map(); }
  let value: unknown;
  try { value = JSON.parse(text); } catch (error) {
    throw new Error(`downloads.json: is not valid JSON (${formatError(error)})`);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("downloads.json: must be an object mapping template id to a download count");
  }
  const counts = new Map<string, number>();
  for (const [id, count] of Object.entries(value)) {
    if (!isDownloadCount(count)) { throw new Error(`downloads.json: "${id}" must be a non-negative integer`); }
    counts.set(id, count);
  }
  return counts;
}

const describe = (bytes: Uint8Array): CatalogAsset => ({ size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });

/** The index entry of one template folder; throws a reason naming what is wrong. */
async function loadTemplate(folder: string, id: string): Promise<CatalogEntry> {
  const manifest = parseTemplateManifest(await fs.promises.readFile(path.join(folder, "template.yaml"), "utf8").catch(() => ""));
  if (!manifest.ok) { throw new Error(manifest.reason); }
  if (manifest.manifest.id !== id) { throw new Error(`id: "${manifest.manifest.id}" differs from the folder name "${id}"`); }
  const files = await readTemplateTree(path.join(folder, "files"));
  if (!files.some((file) => file.path === manifest.manifest.main)) { throw new Error("main: is not among files"); }
  const previews = await readPreviews(path.join(folder, "preview"));
  if ("problem" in previews) { throw new Error(previews.problem); }
  return {
    ...manifest.manifest,
    files: files.map((file) => ({ path: file.path, ...describe(file.bytes) })),
    thumbnail: describe(previews.value.thumbnail),
    sample: describe(previews.value.sample),
  };
}

async function templateFolders(root: string): Promise<string[] | undefined> {
  const found = await fs.promises.readdir(path.join(root, "templates"), { withFileTypes: true }).catch(() => undefined);
  return found?.filter((item) => item.isDirectory()).map((item) => item.name).sort();
}

/** Loads `<root>/templates/<id>/` for every id, sorted by id; a missing templates folder is one problem with an empty id. */
async function loadCatalog(root: string): Promise<LoadedCatalog> {
  const ids = await templateFolders(root);
  if (ids === undefined) { return { entries: [], problems: [{ id: "", reason: "templates: folder is missing" }] }; }
  const result: LoadedCatalog = { entries: [], problems: [] };
  for (const id of ids) {
    try { result.entries.push(await loadTemplate(path.join(root, "templates", id), id)); } catch (error) {
      result.problems.push({ id, reason: formatError(error) });
    }
  }
  return result;
}

/** One problem per broken template folder, sorted by id; empty for a good catalog. */
export async function checkCatalog(root: string): Promise<CatalogProblem[]> {
  return (await loadCatalog(root)).problems;
}

/** Deterministic index text ending in a newline; throws listing every problem as `<id>: <reason>`, or naming a bad downloads.json. */
export async function buildCatalogIndex(root: string, commit: string): Promise<string> {
  const { entries, problems } = await loadCatalog(root);
  if (problems.length > 0) { throw new Error(problems.map((p) => `${p.id}: ${p.reason}`).join("\n")); }
  const counts = await readDownloadCounts(root);
  // INVARIANT: loadCatalog puts sample last, so downloads lands after it and the key order stays stable.
  const templates = entries.map((entry) => {
    const downloads = counts.get(entry.id);
    return downloads === undefined ? entry : { ...entry, downloads };
  });
  return `${JSON.stringify({ schema: 1, commit, templates }, null, 2)}\n`;
}
