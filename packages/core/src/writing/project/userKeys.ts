/** Validates the keys of labshelf.yaml that only the user writes: figure recipes, JSON value files and the pre-submission check. */
// CONTRACT: documents/contracts/library-format.md#labshelfyaml

/** How one figure is made: the command and the files whose changes make the figure stale. */
export interface FigureRecipe {
  run: string;
  /** Paths or glob patterns (`*`, `**`, `?`), relative to the project folder. */
  inputs: string[];
}

/** What the pre-submission check holds the PDF to. */
export interface CheckSettings {
  /** Most pages allowed before the references. */
  pages?: number | undefined;
  /** Names that must not appear in an anonymous submission, besides the git user and the PDF's own author field. */
  authors?: string[] | undefined;
  /** False for a camera-ready, which skips the anonymity rules. */
  anonymous: boolean;
}

export interface UserKeys {
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
  const { pages, authors, anonymous } = value;
  if (!isAbsent(pages) && !(Number.isInteger(pages) && (pages as number) > 0)) { return "check.pages must be a positive whole number"; }
  if (!isAbsent(authors) && !isTextList(authors)) { return "check.authors must be a list of names"; }
  if (!isAbsent(anonymous) && typeof anonymous !== "boolean") { return "check.anonymous must be true or false"; }
  return { pages: (pages as number | null | undefined) ?? undefined, authors: authors ?? undefined, anonymous: anonymous ?? true };
}

/** The user keys of a parsed labshelf.yaml mapping, or the reason they are invalid. */
export function readUserKeys(raw: Record<string, unknown>): UserKeys | string {
  const keys: UserKeys = {};
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
