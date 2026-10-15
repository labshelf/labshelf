/** Parses and rewrites a project's labshelf.yaml, keeping the user's comments and the keys LabShelf does not own. */
// CONTRACT: documents/contracts/library-format.md#labshelfyaml

import YAML from "yaml";

export const PROJECT_FILE = "labshelf.yaml";
export const DEFAULT_BIBLIOGRAPHY = "labshelf.bib";

export const PROJECT_FORMATS = ["latex", "typst"] as const;
export type ProjectFormat = (typeof PROJECT_FORMATS)[number];

export const LATEX_ENGINES = ["tectonic", "xelatex", "pdflatex", "lualatex"] as const;
export type LatexEngine = (typeof LATEX_ENGINES)[number];

export interface ProjectSettings {
  id: string;
  format: ProjectFormat;
  /** Path of the main file, relative to the project folder. */
  main?: string | undefined;
  engine?: LatexEngine | undefined;
  bibliography?: string | undefined;
  /** Typst compiler version of the last build. */
  typst?: string | undefined;
}

/** Settings LabShelf may rewrite after creation; undefined removes the key. */
export type ProjectSettingsPatch = Partial<Omit<ProjectSettings, "id" | "format">>;

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
  return { ok: true, settings };
}

/** The text of a new labshelf.yaml. */
export function serializeProjectFile(settings: ProjectSettings): string {
  const ordered = Object.fromEntries(Object.entries(settings).filter(([, value]) => value !== undefined));
  return YAML.stringify(ordered);
}

/** Applies a patch to existing labshelf.yaml text, leaving comments, key order and unknown keys as they are. */
export function updateProjectFile(text: string, patch: ProjectSettingsPatch): string {
  const doc = YAML.parseDocument(text);
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) { doc.delete(key); } else { doc.set(key, value); }
  }
  return doc.toString();
}
