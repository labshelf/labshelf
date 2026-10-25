/** Reads and validates a template's template.yaml, and the manifest fields the catalog index shares. */
// CONTRACT: documents/contracts/templates.md#manifest

import YAML from "yaml";
import { LATEX_ENGINES, PROJECT_FORMATS, type ProjectFormat } from "../../writing/project/index.js";
import { isLicenseExpression } from "./templateLicense.js";
import { deriveTemplatePathProblem } from "./templatePaths.js";

export const TEMPLATE_CATEGORIES = ["article", "thesis", "poster", "slides", "cv", "other"] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

export const TEMPLATE_ENGINES = [...LATEX_ENGINES, "typst"] as const;
export type TemplateEngine = (typeof TEMPLATE_ENGINES)[number];

export interface TemplateManifest {
  id: string;
  name: string;
  description: string;
  category: TemplateCategory;
  format: ProjectFormat;
  engine: TemplateEngine;
  /** Path of the main file, relative to the template's files/ folder. */
  main: string;
  /** Typst only: the lowest Typst version that builds the template. */
  compiler?: string;
  license: string;
  authors: string[];
}

/** What installing a template needs from its manifest; a blank template has no engine. */
export type ProjectTemplate = Pick<TemplateManifest, "id" | "format" | "main"> & Partial<Pick<TemplateManifest, "engine">>;

export type TemplateManifestResult = { ok: true; manifest: TemplateManifest } | { ok: false; reason: string };

const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

function textProblem(value: unknown, maxLength: number, singleLine: boolean): string | undefined {
  if (typeof value !== "string" || value.trim() === "") { return "is missing"; }
  if (value.length > maxLength) { return `is longer than ${maxLength} characters`; }
  return singleLine && /[\r\n]/.test(value) ? "must be one line" : undefined;
}

function idProblem(value: unknown): string | undefined {
  const problem = textProblem(value, 64, true);
  if (problem !== undefined) { return problem; }
  return ID_PATTERN.test(value as string) ? undefined : "must be lowercase letters and digits joined by single hyphens";
}

function mainProblem(value: unknown, format: unknown): string | undefined {
  if (typeof value !== "string") { return "is missing"; }
  const extension = format === "typst" ? ".typ" : ".tex";
  return deriveTemplatePathProblem(value) ?? (value.endsWith(extension) ? undefined : `must end in ${extension}`);
}

function compilerProblem(value: unknown, format: unknown): string | undefined {
  if (value === undefined) { return undefined; }
  if (format !== "typst") { return "is only allowed for a typst template"; }
  return typeof value === "string" && VERSION_PATTERN.test(value) ? undefined : "must look like 0.13.1";
}

function engineProblem(value: unknown, format: unknown): string | undefined {
  if (!isOneOf(TEMPLATE_ENGINES, value)) { return `must be one of ${TEMPLATE_ENGINES.join(", ")}`; }
  if (format === "typst") { return value === "typst" ? undefined : "must be typst for a typst template"; }
  return value === "typst" ? "must be a LaTeX engine for a latex template" : undefined;
}

function licenseProblem(value: unknown): string | undefined {
  return typeof value === "string" && isLicenseExpression(value) ? undefined : "must be an SPDX identifier or expression";
}

function authorsProblem(value: unknown): string | undefined {
  const valid = Array.isArray(value) && value.length > 0 && value.every((a) => typeof a === "string" && a.trim() !== "");
  return valid ? undefined : "must list at least one author";
}

function firstProblem(record: Record<string, unknown>): string | undefined {
  const problems: [string, string | undefined][] = [
    ["id", idProblem(record["id"])],
    ["name", textProblem(record["name"], 80, true)],
    ["description", textProblem(record["description"], 500, false)],
    ["category", isOneOf(TEMPLATE_CATEGORIES, record["category"]) ? undefined : `must be one of ${TEMPLATE_CATEGORIES.join(", ")}`],
    ["format", isOneOf(PROJECT_FORMATS, record["format"]) ? undefined : `must be one of ${PROJECT_FORMATS.join(", ")}`],
    ["engine", engineProblem(record["engine"], record["format"])],
    ["main", mainProblem(record["main"], record["format"])],
    ["compiler", compilerProblem(record["compiler"], record["format"])],
    ["license", licenseProblem(record["license"])],
    ["authors", authorsProblem(record["authors"])],
  ];
  const failed = problems.find(([, problem]) => problem !== undefined);
  return failed && `${failed[0]}: ${failed[1]}`;
}

/** Validates the manifest keys of a record; the reason of a refusal starts with the offending key. Unknown keys are ignored. */
export function readTemplateFields(record: Record<string, unknown>): TemplateManifestResult {
  const problem = firstProblem(record);
  if (problem !== undefined) { return { ok: false, reason: problem }; }
  const manifest = {
    id: record["id"], name: record["name"], description: record["description"], category: record["category"],
    format: record["format"], engine: record["engine"], main: record["main"],
    ...(record["compiler"] === undefined ? {} : { compiler: record["compiler"] }),
    license: record["license"], authors: record["authors"],
  } as TemplateManifest;
  return { ok: true, manifest };
}

/** The reason a schema value is refused, or undefined for the supported schema 1. */
export function schemaProblem(value: unknown): string | undefined {
  if (typeof value === "number" && value > 1) { return "schema: needs a newer LabShelf"; }
  return value === 1 ? undefined : "schema: must be 1";
}

/** Reads a template.yaml; never throws. */
export function parseTemplateManifest(yamlText: string): TemplateManifestResult {
  const doc = YAML.parseDocument(yamlText);
  if (doc.errors.length > 0) { return { ok: false, reason: `invalid YAML: ${doc.errors[0]!.message}` }; }
  const value: unknown = doc.toJS();
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, reason: "template.yaml is not a mapping" };
  }
  const record = value as Record<string, unknown>;
  const problem = schemaProblem(record["schema"]);
  return problem === undefined ? readTemplateFields(record) : { ok: false, reason: problem };
}

/** Writes a manifest as template.yaml text, keys in contract order; the yaml library quotes values that need it. */
export function serializeTemplateManifest(manifest: TemplateManifest): string {
  const { id, name, description, category, format, engine, main, compiler, license, authors } = manifest;
  return YAML.stringify({ schema: 1, id, name, description, category, format, engine, main, ...(compiler === undefined ? {} : { compiler }), license, authors });
}
