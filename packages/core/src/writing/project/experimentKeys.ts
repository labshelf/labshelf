/** Validates the experiment-data keys of labshelf.yaml: the figure recipes and the JSON value files. */
// CONTRACT: documents/contracts/library-format.md#labshelfyaml

/** How one figure is made: the command and the files whose changes make the figure stale. */
export interface FigureRecipe {
  run: string;
  /** Paths or glob patterns (`*`, `**`, `?`), relative to the project folder. */
  inputs: string[];
}

export interface ExperimentKeys {
  /** Figure path, relative to the project folder, to its recipe. */
  figures?: Record<string, FigureRecipe> | undefined;
  /** JSON files, relative to the project folder, whose leaves `\lsvalue` and Typst `json()` read. */
  values?: string[] | undefined;
}

const isText = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";
const isTextList = (value: unknown): value is string[] => Array.isArray(value) && value.every(isText);

function readFigures(value: unknown): Record<string, FigureRecipe> | string {
  if (value === null || typeof value !== "object" || Array.isArray(value)) { return "figures must map figure paths to recipes"; }
  const figures: Record<string, FigureRecipe> = {};
  for (const [path, recipe] of Object.entries(value as Record<string, unknown>)) {
    if (recipe === null || typeof recipe !== "object" || Array.isArray(recipe)) { return `figures.${path} must be a mapping`; }
    const { run, inputs } = recipe as Record<string, unknown>;
    if (!isText(run)) { return `figures.${path}.run must be text`; }
    if (inputs !== undefined && inputs !== null && !isTextList(inputs)) { return `figures.${path}.inputs must be a list of paths`; }
    figures[path] = { run, inputs: inputs ?? [] };
  }
  return figures;
}

/** The experiment keys of a parsed labshelf.yaml mapping, or the reason they are invalid. */
export function readExperimentKeys(raw: Record<string, unknown>): ExperimentKeys | string {
  const keys: ExperimentKeys = {};
  if (raw["figures"] !== undefined && raw["figures"] !== null) {
    const figures = readFigures(raw["figures"]);
    if (typeof figures === "string") { return figures; }
    keys.figures = figures;
  }
  const values = raw["values"];
  if (values !== undefined && values !== null) {
    if (!isTextList(values)) { return "values must be a list of JSON file paths"; }
    keys.values = values;
  }
  return keys;
}
