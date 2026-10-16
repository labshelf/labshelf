/** Parses the Community catalog's index.json, keeping the entries that pass the manifest and path rules. */
// CONTRACT: documents/contracts/templates.md#index

import { templateTreeProblem } from "./templatePaths.js";
import { readTemplateFields, schemaProblem, type TemplateManifest } from "./templateManifest.js";

export interface CatalogFile { path: string; size: number; sha256: string }
export interface CatalogBlob { size: number; sha256: string }
export interface CatalogEntry extends TemplateManifest {
  files: CatalogFile[];
  thumbnail: CatalogBlob;
  sample: CatalogBlob;
}

export interface SkippedEntry { id: string | undefined; reason: string }
export type CatalogIndexResult =
  | { ok: true; commit: string; entries: CatalogEntry[]; skipped: SkippedEntry[] }
  | { ok: false; reason: string };

type Parsed<T> = { value: T } | { problem: string };

const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readBlob(value: unknown): CatalogBlob | undefined {
  if (!isRecord(value)) { return undefined; }
  const { size, sha256 } = value;
  const valid = typeof size === "number" && Number.isInteger(size) && size >= 0
    && typeof sha256 === "string" && SHA256_PATTERN.test(sha256);
  return valid ? { size, sha256 } : undefined;
}

function readFiles(value: unknown): CatalogFile[] | undefined {
  if (!Array.isArray(value)) { return undefined; }
  const files: CatalogFile[] = [];
  for (const item of value) {
    const blob = readBlob(item);
    const path = isRecord(item) ? item["path"] : undefined;
    if (blob === undefined || typeof path !== "string") { return undefined; }
    files.push({ path, ...blob });
  }
  return files;
}

function readEntry(raw: Record<string, unknown>): Parsed<CatalogEntry> {
  const fields = readTemplateFields(raw);
  if (!fields.ok) { return { problem: fields.reason }; }
  const files = readFiles(raw["files"]);
  if (files === undefined) { return { problem: "files: must list { path, size, sha256 } objects" }; }
  const treeProblem = templateTreeProblem(files);
  if (treeProblem !== undefined) { return { problem: `files: ${treeProblem}` }; }
  if (!files.some((file) => file.path === fields.manifest.main)) { return { problem: "main: is not among files" }; }
  const thumbnail = readBlob(raw["thumbnail"]);
  if (thumbnail === undefined) { return { problem: "thumbnail: must be { size, sha256 }" }; }
  const sample = readBlob(raw["sample"]);
  if (sample === undefined) { return { problem: "sample: must be { size, sha256 }" }; }
  return { value: { ...fields.manifest, files, thumbnail, sample } };
}

function readEntries(templates: unknown[]): { entries: CatalogEntry[]; skipped: SkippedEntry[] } {
  const entries: CatalogEntry[] = [];
  const skipped: SkippedEntry[] = [];
  const seen = new Set<string>();
  for (const raw of templates) {
    if (!isRecord(raw)) { skipped.push({ id: undefined, reason: "entry is not an object" }); continue; }
    const id = typeof raw["id"] === "string" ? raw["id"] : undefined;
    const parsed = readEntry(raw);
    if ("problem" in parsed) { skipped.push({ id, reason: parsed.problem }); continue; }
    if (seen.has(parsed.value.id)) { skipped.push({ id, reason: "id: appears twice" }); continue; }
    seen.add(parsed.value.id);
    entries.push(parsed.value);
  }
  return { entries, skipped };
}

/** Reads index.json; a whole-index problem refuses it, an entry-level problem skips only that entry. Never throws. */
export function parseCatalogIndex(jsonText: string): CatalogIndexResult {
  let value: unknown;
  try { value = JSON.parse(jsonText); } catch (error) {
    return { ok: false, reason: `invalid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!isRecord(value)) { return { ok: false, reason: "index.json is not an object" }; }
  const problem = schemaProblem(value["schema"]);
  if (problem !== undefined) { return { ok: false, reason: problem }; }
  const commit = value["commit"];
  if (typeof commit !== "string" || !COMMIT_PATTERN.test(commit)) {
    return { ok: false, reason: "commit: must be a 40-character lowercase hex hash" };
  }
  const templates = value["templates"];
  if (!Array.isArray(templates)) { return { ok: false, reason: "templates: must be an array" }; }
  return { ok: true, commit, ...readEntries(templates) };
}
