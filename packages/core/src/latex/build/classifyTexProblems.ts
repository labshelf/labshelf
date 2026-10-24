// Spots the two build problems the helper reacts to: a missing TeX file and a document that needs shell escape.
import type { BuildProblem } from "../log/index.js";

export interface TexProblemClass {
  missingFile?: string;
  /** Why the build needs shell escape, which the helper never enables. */
  shellEscape?: string;
}

// The wordings come from core's explainTexMessage; a `source:` prefix may precede them, so they are not anchored.
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

export function classifyTexProblems(problems: BuildProblem[]): TexProblemClass {
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
