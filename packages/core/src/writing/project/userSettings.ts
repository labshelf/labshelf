/** Validates the user keys of labshelf.yaml: figure recipes, JSON value files and the pre-submission check (whose limits the preview also writes). */
// CONTRACT: documents/contracts/library-format.md#labshelfyaml

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

const isText = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";
const isTextList = (value: unknown): value is string[] => Array.isArray(value) && value.every(isText);
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
    if (!isText(run)) { return `figures.${path}.run must be text`; }
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
