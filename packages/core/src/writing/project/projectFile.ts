/** Parses and rewrites a project's labshelf.yaml, keeping the user's comments and the keys LabShelf does not own. */
// CONTRACT: documents/contracts/library-format.md#labshelfyaml

import YAML from "yaml";
import { readUserKeys, type CountUpTo, type UserKeys } from "./userKeys.js";
import { readListedPapers, type ListedPaper } from "./listedPapers.js";

export const PROJECT_FILE = "labshelf.yaml";
export const DEFAULT_BIBLIOGRAPHY = "labshelf.bib";

export const PROJECT_FORMATS = ["latex", "typst"] as const;
export type ProjectFormat = (typeof PROJECT_FORMATS)[number];

export const LATEX_ENGINES = ["tectonic", "xelatex", "pdflatex", "lualatex"] as const;
export type LatexEngine = (typeof LATEX_ENGINES)[number];

export interface ProjectSettings extends UserKeys {
  id: string;
  format: ProjectFormat;
  /** Path of the main file, relative to the project folder. */
  main?: string | undefined;
  engine?: LatexEngine | undefined;
  bibliography?: string | undefined;
  /** Typst compiler version of the last build. */
  typst?: string | undefined;
  /** Sidebar folder the project sits in, segments joined by "/"; absent at the top level. */
  folder?: string | undefined;
  /** Archived projects leave My projects for the Archived group. */
  archived?: boolean | undefined;
  /** Display name; the shown name is `title ?? id`. Renaming writes it and never changes `id` or the folder. */
  title?: string | undefined;
  /** ISO 8601 time since which the project is in the trash; restoring removes the key. */
  trashed?: string | undefined;
  /** Papers the project cites plus those the user added, each with its DOI when known. */
  papers?: ListedPaper[] | undefined;
}

/** The `check:` limits the preview edits. */
export interface CheckLimits {
  pages: number;
  words: number;
  countUpTo: CountUpTo;
}

/** Settings LabShelf may rewrite after creation; undefined removes the key, an absent key stays as it is. Of the user keys only the check limits are LabShelf's to write. */
export type ProjectSettingsPatch = Partial<Omit<ProjectSettings, "id" | "format" | keyof UserKeys>> & {
  check?: { [K in keyof CheckLimits]?: CheckLimits[K] | undefined };
};

export type ProjectFileResult =
  | { ok: true; settings: ProjectSettings }
  | { ok: false; reason: string };

const OPTIONAL_STRING_KEYS = ["main", "bibliography", "typst"] as const;

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

function readMapping(text: string): Record<string, unknown> | string {
  const doc = YAML.parseDocument(text);
  if (doc.errors.length > 0) { return `invalid YAML: ${doc.errors[0]!.message}`; }
  const value: unknown = doc.toJS();
  if (value === null || typeof value !== "object" || Array.isArray(value)) { return "labshelf.yaml is not a mapping"; }
  return value as Record<string, unknown>;
}

/** Reads the settings; the reason of a failure names the offending key so the user can fix the file. */
export function parseProjectFile(text: string): ProjectFileResult {
  const raw = readMapping(text);
  if (typeof raw === "string") { return { ok: false, reason: raw }; }
  if (typeof raw["id"] !== "string" || raw["id"].trim() === "") { return { ok: false, reason: "id is missing" }; }
  if (!isOneOf(PROJECT_FORMATS, raw["format"])) {
    return { ok: false, reason: `format must be one of ${PROJECT_FORMATS.join(", ")}` };
  }
  if (raw["engine"] !== undefined && !isOneOf(LATEX_ENGINES, raw["engine"])) {
    return { ok: false, reason: `engine must be one of ${LATEX_ENGINES.join(", ")}` };
  }
  const settings: ProjectSettings = { id: raw["id"], format: raw["format"], engine: raw["engine"] };
  for (const key of OPTIONAL_STRING_KEYS) {
    const value = raw[key];
    // A YAML number such as `typst: 0.13` is still a version string to the user.
    if (typeof value === "number") { settings[key] = String(value); continue; }
    if (value !== undefined && value !== null && typeof value !== "string") {
      return { ok: false, reason: `${key} must be text` };
    }
    settings[key] = value ?? undefined;
  }
  if (typeof raw["folder"] === "string") {
    const folder = raw["folder"].split("/").map((segment) => segment.trim()).filter(Boolean).join("/");
    settings.folder = folder || undefined;
  } else if (raw["folder"] !== undefined && raw["folder"] !== null) { return { ok: false, reason: "folder must be text" }; }
  if (raw["archived"] !== undefined && raw["archived"] !== null && typeof raw["archived"] !== "boolean") {
    return { ok: false, reason: "archived must be true or false" };
  }
  if (raw["archived"] === true) { settings.archived = true; }
  for (const key of ["title", "trashed"] as const) {
    const value = raw[key];
    if (value !== undefined && value !== null && typeof value !== "string") { return { ok: false, reason: `${key} must be text` }; }
    if (typeof value === "string" && value.trim() !== "") { settings[key] = value.trim(); }
  }
  const userKeys = readUserKeys(raw);
  if (typeof userKeys === "string") { return { ok: false, reason: userKeys }; }
  if (raw["papers"] !== undefined && raw["papers"] !== null) {
    const papers = readListedPapers(raw["papers"]);
    if (typeof papers === "string") { return { ok: false, reason: papers }; }
    settings.papers = papers;
  }
  return { ok: true, settings: { ...settings, ...userKeys } };
}

/** The text of a new labshelf.yaml. */
export function serializeProjectFile(settings: ProjectSettings): string {
  const ordered = Object.fromEntries(Object.entries(settings).filter(([, value]) => value !== undefined));
  return YAML.stringify(ordered);
}

/** Applies a patch to existing labshelf.yaml text, leaving comments, key order and unknown keys as they are. */
export function updateProjectFile(text: string, patch: ProjectSettingsPatch): string {
  const doc = YAML.parseDocument(text);
  const { check, ...rest } = patch;
  for (const [key, value] of Object.entries(rest)) {
    if (value === undefined) { doc.delete(key); } else { doc.set(key, value); }
  }
  if (check !== undefined) { patchCheckLimits(doc, check); }
  return doc.toString();
}

/** The labshelf.yaml of a copy: every key and comment of `text`, under the copy's id. */
export function projectFileWithId(text: string, id: string): string {
  const doc = YAML.parseDocument(text);
  doc.set("id", id);
  return doc.toString();
}

function patchCheckLimits(doc: YAML.Document, check: NonNullable<ProjectSettingsPatch["check"]>): void {
  for (const [key, value] of Object.entries(check)) {
    if (value === undefined) { doc.deleteIn(["check", key]); } else { doc.setIn(["check", key], value); }
  }
  const mapping = doc.get("check");
  if (YAML.isMap(mapping) && mapping.items.length === 0) { doc.delete("check"); }
}
