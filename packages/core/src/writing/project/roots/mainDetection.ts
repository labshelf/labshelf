/** Finds a project's format and main file from the source files at its root, for projects whose labshelf.yaml names none. */

import type { ProjectFormat } from "../projectFile.js";

const EXTENSION: Record<ProjectFormat, string> = { latex: ".tex", typst: ".typ" };
const CONVENTIONAL_MAIN: Record<ProjectFormat, string> = { latex: "main.tex", typst: "main.typ" };

// A commented-out `% \documentclass` does not count: the line must start with the command.
export const DOCUMENT_CLASS = /^[ \t]*\\documentclass\b/m;

/** Source files of the format, the conventional main name first, then alphabetical. */
export function mainCandidates(format: ProjectFormat, fileNames: readonly string[]): string[] {
  const main = CONVENTIONAL_MAIN[format];
  return fileNames
    .filter((name) => name.toLowerCase().endsWith(EXTENSION[format]))
    .sort((a, b) => Number(b === main) - Number(a === main) || a.localeCompare(b));
}

/**
 * LaTeX: the first candidate that declares `\documentclass`. Typst has no such marker, so only `main.typ` is taken.
 * @returns undefined when nothing qualifies; the user then picks the main by hand
 */
export async function detectMainFile(
  format: ProjectFormat,
  fileNames: readonly string[],
  readText: (name: string) => Promise<string | undefined>,
): Promise<string | undefined> {
  if (format === "typst") { return fileNames.includes(CONVENTIONAL_MAIN.typst) ? CONVENTIONAL_MAIN.typst : undefined; }
  for (const name of mainCandidates(format, fileNames)) {
    const text = await readText(name);
    if (text !== undefined && DOCUMENT_CLASS.test(text)) { return name; }
  }
  return undefined;
}

/** The format a folder's sources suggest: LaTeX wins when both kinds are present; undefined when neither is. */
export function detectFormat(fileNames: readonly string[]): ProjectFormat | undefined {
  if (mainCandidates("latex", fileNames).length > 0) { return "latex"; }
  if (mainCandidates("typst", fileNames).length > 0) { return "typst"; }
  return undefined;
}
