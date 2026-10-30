// The languages a note's code cell can run, and how a fence language names one.
export type CellLanguage = "python" | "mathematica" | "r";

export const CELL_LANGUAGES: readonly CellLanguage[] = ["python", "mathematica", "r"];

const ALIASES: Readonly<Record<string, CellLanguage>> = { python: "python", mathematica: "mathematica", wolfram: "mathematica", wl: "mathematica", r: "r" };

const LABELS: Readonly<Record<CellLanguage, string>> = { python: "Python", mathematica: "Mathematica", r: "R" };

/** @returns the cell language a fence language names (case-insensitive; `wolfram` and `wl` are Mathematica), or undefined when it is not one. */
export function toCellLanguage(lang: string | null | undefined): CellLanguage | undefined {
  if (!lang) { return undefined; }
  const key = lang.toLowerCase();
  return Object.hasOwn(ALIASES, key) ? ALIASES[key] : undefined;
}

/** @returns whether `value` is one of CELL_LANGUAGES exactly (no aliases, case-sensitive). */
export function isCellLanguage(value: unknown): value is CellLanguage {
  return typeof value === "string" && (CELL_LANGUAGES as readonly string[]).includes(value);
}

/** @returns the name a view shows for `language`. */
export function cellLanguageLabel(language: CellLanguage): string {
  return LABELS[language];
}
