/** Classifies the problems of a build: the ones the helper reacts to, and a section document's problems moved onto the edited file's lines. */
import type { BuildProblem } from "./log.js";

export interface TexProblemClass {
  missingFile?: string;
  /** Why the build needs shell escape, which the helper never enables. */
  shellEscape?: string;
}

// The wordings come from core's describeTexMessage; a `source:` prefix may precede them, so they are not anchored.
const MISSING_FILE: Array<[RegExp, (name: string) => string]> = [
  [/Package "([^"]+)" is not installed/, (name) => `${name}.sty`],
  [/Document class "([^"]+)" is not installed/, (name) => `${name}.cls`],
  [/File "([^"]+)" not found/, (name) => name],
];
const SHELL_ESCAPE = /shell[- ]?escape|\bminted\b/i;

function missingFile(message: string): string | undefined {
  for (const [pattern, fileName] of MISSING_FILE) {
    const name = pattern.exec(message)?.[1];
    if (name) { return fileName(name); }
  }
  return undefined;
}

export function deriveTexProblemClass(problems: BuildProblem[]): TexProblemClass {
  const result: TexProblemClass = {};
  for (const problem of problems.filter((p) => p.severity === "error")) {
    const file = missingFile(problem.message);
    if (file && !result.missingFile) { result.missingFile = file; }
    if (!result.shellEscape && SHELL_ESCAPE.test(problem.message)) {
      const cause = /\bminted\b/i.test(problem.message) ? "the minted package" : "shell escape";
      result.shellEscape = `The document needs ${cause}, which runs external programs; LabShelf Helper does not allow that.`;
    }
  }
  return result;
}

export interface SectionPlacement {
  /** Base name of the section document the engine compiled. */
  documentName: string;
  editedFile: string;
  /** Lines the section document holds above the section's first line. */
  headerLines: number;
  /** Zero-based line of the section's first line in the edited file. */
  startLine: number;
}

/** A problem on a header line has no source line, so it lands on the section's first line. */
export function deriveSectionProblems<P extends { file?: string; line?: number }>(problems: readonly P[], place: SectionPlacement): P[] {
  return problems.map((problem) => {
    if (problem.file?.split(/[\\/]/).pop() !== place.documentName) { return problem; }
    const line = problem.line === undefined ? place.startLine + 1 : Math.max(problem.line - place.headerLines, 1) + place.startLine;
    return { ...problem, file: place.editedFile, line };
  });
}
