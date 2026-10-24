// Turns core's build problems, which carry absolute paths, into the project paths the page knows.
import * as path from "node:path";

import type { LocatedProblem } from "../../../../latex/build/index.js";

// CONTRACT: documents/contracts/helper.md#messages
export function pageProblems(problems: readonly LocatedProblem[], sourceDir: string): LocatedProblem[] {
  return problems.map((problem) => ({ ...problem, file: path.relative(sourceDir, problem.file).split(path.sep).join("/") }));
}
