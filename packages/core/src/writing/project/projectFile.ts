/** Models a project's labshelf.yaml: parsing and rewriting it (keeping the user's comments and the keys LabShelf does not own), validating its user keys, and the project id slug. */
// CONTRACT: documents/contracts/library-format.md#labshelfyaml

import YAML from "yaml";
import { isNonBlankString, isOneOf } from "../../guards/index.js";
import { isCalendarDay } from "../../time/index.js";
import { normalizeText } from "../../library/index.js";

// --- User keys of labshelf.yaml ---

/** How one figure is made: the command and the files whose changes make the figure stale. */
export interface FigureRecipe {
  run: string;
  /** Paths or glob patterns (`*`, `**`, `?`), relative to the project folder. */
  inputs: string[];
}

/** Where the page and word limits stop counting: at the References heading or at the end of the document. */
export type CountUpTo = "references" | "end";

/** What the pre-submission check holds the PDF to. */
export interface CheckSettings {
  /** Most pages allowed before the references. */
  pages?: number | undefined;
  /** Most words allowed, counted up to the same point as the page limit. */
  words?: number | undefined;
  /** Absent counts up to the References heading. */
  countUpTo?: CountUpTo | undefined;
  /** Names that must not appear in an anonymous submission, besides the git user and the PDF's own author field. */
  authors?: string[] | undefined;
  /** False for a camera-ready, which skips the anonymity rules. */
  anonymous: boolean;
}

export interface UserSettings {
  /** Figure path, relative to the project folder, to its recipe. */
  figures?: Record<string, FigureRecipe> | undefined;
  /** JSON files, relative to the project folder, whose leaves `\lsvalue` and Typst `json()` read. */
  values?: string[] | undefined;
  check?: CheckSettings | undefined;
}

const isTextList = (value: unknown): value is string[] => Array.isArray(value) && value.every(isNonBlankString);
const isMapping = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const isPositiveWhole = (value: unknown): value is number => Number.isInteger(value) && (value as number) > 0;
const isAbsent = (value: unknown): value is undefined | null => value === undefined || value === null;

function readFigures(value: unknown): Record<string, FigureRecipe> | string {
  if (!isMapping(value)) { return "figures must map figure paths to recipes"; }
  const figures: Record<string, FigureRecipe> = {};
  for (const [path, recipe] of Object.entries(value)) {
    if (!isMapping(recipe)) { return `figures.${path} must be a mapping`; }
    const { run, inputs } = recipe;
    if (!isNonBlankString(run)) { return `figures.${path}.run must be text`; }
    if (!isAbsent(inputs) && !isTextList(inputs)) { return `figures.${path}.inputs must be a list of paths`; }
    figures[path] = { run, inputs: inputs ?? [] };
  }
  return figures;
}

function readCheck(value: unknown): CheckSettings | string {
  if (!isMapping(value)) { return "check must be a mapping"; }
  const { pages, words, countUpTo, authors, anonymous } = value;
  if (!isAbsent(pages) && !isPositiveWhole(pages)) { return "check.pages must be a positive whole number"; }
  if (!isAbsent(words) && !isPositiveWhole(words)) { return "check.words must be a positive whole number"; }
  if (!isAbsent(countUpTo) && countUpTo !== "references" && countUpTo !== "end") { return "check.countUpTo must be references or end"; }
  if (!isAbsent(authors) && !isTextList(authors)) { return "check.authors must be a list of names"; }
  if (!isAbsent(anonymous) && typeof anonymous !== "boolean") { return "check.anonymous must be true or false"; }
  return { pages: pages ?? undefined, words: words ?? undefined, countUpTo: countUpTo ?? undefined, authors: authors ?? undefined, anonymous: anonymous ?? true };
}

/** The user keys of a parsed labshelf.yaml mapping, or the reason they are invalid. */
export function readUserSettings(raw: Record<string, unknown>): UserSettings | string {
  const keys: UserSettings = {};
  if (!isAbsent(raw["figures"])) {
    const figures = readFigures(raw["figures"]);
    if (typeof figures === "string") { return figures; }
    keys.figures = figures;
  }
  const values = raw["values"];
  if (!isAbsent(values)) {
    if (!isTextList(values)) { return "values must be a list of JSON file paths"; }
    keys.values = values;
  }
  if (!isAbsent(raw["check"])) {
    const check = readCheck(raw["check"]);
    if (typeof check === "string") { return check; }
    keys.check = check;
  }
  return keys;
}

// --- Papers a project lists ---

/** A paper a project depends on, listed by cite key. */
export interface ListedPaper {
  /** The paper's cite key. */
  key: string;
  doi?: string | undefined;
  /** True when the sync added the entry because the sources cite it; absent for an entry the user added. */
  cited?: true | undefined;
}

/** The entries of a parsed `papers` value, or the reason it is invalid. */
function readListedPapers(value: unknown): ListedPaper[] | string {
  if (!Array.isArray(value)) { return "papers must be a list of {key, doi, cited} entries"; }
  const listed: ListedPaper[] = [];
  for (const [index, entry] of value.entries()) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) { return `papers[${index}] must be a mapping`; }
    const { key, doi, cited } = entry as Record<string, unknown>;
    if (!isNonBlankString(key)) { return `papers[${index}].key must be text`; }
    if (doi !== undefined && doi !== null && !isNonBlankString(doi)) { return `papers[${index}].doi must be text`; }
    if (cited !== undefined && cited !== null && typeof cited !== "boolean") { return `papers[${index}].cited must be true or false`; }
    listed.push({ key, ...doi ? { doi } : {}, ...cited ? { cited: true as const } : {} });
  }
  return listed;
}

// --- The project file ---

export const PROJECT_FILE = "labshelf.yaml";
export const DEFAULT_BIBLIOGRAPHY = "labshelf.bib";

export const PROJECT_FORMATS = ["latex", "typst"] as const;
export type ProjectFormat = (typeof PROJECT_FORMATS)[number];

export const LATEX_ENGINES = ["pdflatex", "xelatex", "lualatex"] as const;
export type LatexEngine = (typeof LATEX_ENGINES)[number];

export interface ProjectSettings extends UserSettings {
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
  /** Share id of a shared project; per user, never synced. */
  shared?: string | undefined;
  /** Papers the project cites plus those the user added, each with its DOI when known. */
  papers?: ListedPaper[] | undefined;
  target?: ProjectSubmission | undefined;
}

/** Where the project is headed: the venue and its submission deadline. */
export interface ProjectSubmission {
  venue?: string | undefined;
  /** A calendar date, `YYYY-MM-DD`, without a time. */
  deadline?: string | undefined;
}

/** The `check:` limits the preview edits. */
export interface CheckLimits {
  pages: number;
  words: number;
  countUpTo: CountUpTo;
}

/** Settings LabShelf may rewrite after creation; undefined removes the key, an absent key stays as it is. Of the user keys only the check limits are LabShelf's to write. `target` writes the keys it holds, clears a key that is empty or undefined, and `null` removes the whole mapping. */
export type ProjectSettingsUpdate = Partial<Omit<ProjectSettings, "id" | "format" | "target" | keyof UserSettings>> & {
  check?: { [K in keyof CheckLimits]?: CheckLimits[K] | undefined };
  target?: ProjectSubmission | null;
};

export type ProjectFileResult =
  | { ok: true; settings: ProjectSettings }
  | { ok: false; reason: string };

const OPTIONAL_STRING_KEYS = ["main", "bibliography", "typst"] as const;

function readTarget(value: unknown): ProjectSubmission | undefined | string {
  if (value === null || typeof value !== "object" || Array.isArray(value)) { return "target must be a mapping"; }
  const { venue, deadline } = value as Record<string, unknown>;
  const target: ProjectSubmission = {};
  if (venue !== undefined && venue !== null) {
    if (typeof venue !== "string") { return "target.venue must be text"; }
    if (venue.trim() !== "") { target.venue = venue.trim(); }
  }
  if (deadline !== undefined && deadline !== null) {
    if (typeof deadline !== "string" || !isCalendarDay(deadline)) { return "target.deadline must be a date as YYYY-MM-DD"; }
    target.deadline = deadline;
  }
  return Object.keys(target).length > 0 ? target : undefined;
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
  for (const key of ["title", "trashed", "shared"] as const) {
    const value = raw[key];
    if (value !== undefined && value !== null && typeof value !== "string") { return { ok: false, reason: `${key} must be text` }; }
    if (typeof value === "string" && value.trim() !== "") { settings[key] = value.trim(); }
  }
  if (raw["target"] !== undefined && raw["target"] !== null) {
    const target = readTarget(raw["target"]);
    if (typeof target === "string") { return { ok: false, reason: target }; }
    settings.target = target;
  }
  const userKeys = readUserSettings(raw);
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
export function updateProjectFile(text: string, patch: ProjectSettingsUpdate): string {
  const doc = YAML.parseDocument(text);
  const { check, target, ...rest } = patch;
  for (const [key, value] of Object.entries(rest)) {
    if (value === undefined) { doc.delete(key); } else { doc.set(key, value); }
  }
  if (check !== undefined) { patchCheckLimits(doc, check); }
  if (target === null) { doc.delete("target"); } else if (target !== undefined) { patchTarget(doc, target); }
  return doc.toString();
}

/** The labshelf.yaml of a copy: every key and comment of `text`, under the copy's id. */
export function withProjectId(text: string, id: string): string {
  const doc = YAML.parseDocument(text);
  doc.set("id", id);
  return doc.toString();
}

function patchCheckLimits(doc: YAML.Document, check: NonNullable<ProjectSettingsUpdate["check"]>): void {
  for (const [key, value] of Object.entries(check)) {
    if (value === undefined) { doc.deleteIn(["check", key]); } else { doc.setIn(["check", key], value); }
  }
  const mapping = doc.get("check");
  if (YAML.isMap(mapping) && mapping.items.length === 0) { doc.delete("check"); }
}

function patchTarget(doc: YAML.Document, target: ProjectSubmission): void {
  // INVARIANT: a written deadline must parse again, or the whole project file becomes unreadable.
  const deadline = target.deadline?.trim();
  if (deadline && !isCalendarDay(deadline)) { throw new Error(`target.deadline must be a date as YYYY-MM-DD, got "${deadline}"`); }
  for (const [key, value] of Object.entries(target)) {
    if (value === undefined || value.trim() === "") { doc.deleteIn(["target", key]); } else { doc.setIn(["target", key], value.trim()); }
  }
  const mapping = doc.get("target");
  if (YAML.isMap(mapping) && mapping.items.length === 0) { doc.delete("target"); }
}

// --- The project id ---

/** "Deep Nets: a Survey" → "deep-nets-a-survey"; "project" when the title has no letters or digits. */
export function deriveProjectIdSlug(title: string): string {
  return normalizeText(title).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "project";
}
