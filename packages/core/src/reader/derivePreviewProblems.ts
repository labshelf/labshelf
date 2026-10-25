// Turns the located problems of a build into the problems a preview root shows.
import type { LocatedProblem } from "../latex/build/index.js";
import type { PreviewProblem } from "./previewProtocol.js";

/** `deriveFileName` turns a problem's file into the name the reader shows; the file is kept as given when absent. */
export function derivePreviewProblems(problems: readonly LocatedProblem[], fileName: (file: string) => string = (file) => file): PreviewProblem[] {
  return problems.map((problem) => ({
    severity: problem.severity,
    message: problem.message,
    ...(problem.hint ? { hint: problem.hint } : {}),
    ...(problem.file ? { file: fileName(problem.file) } : {}),
    ...(problem.line !== undefined ? { line: problem.line } : {}),
  }));
}
