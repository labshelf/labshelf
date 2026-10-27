/** Maps Typst Universe's package index to gallery entries, one per template package at its highest version. */
// CONTRACT: documents/contracts/templates.md#typst-universe

import { isRecord } from "../../guards/index.js";
import { parseCatalogIndexJson, deriveTemplatePathProblem, type SkippedEntry, type TemplateKind } from "../templateManifest/index.js";
import type { TemplateEntry } from "../templateEntry.js";

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
