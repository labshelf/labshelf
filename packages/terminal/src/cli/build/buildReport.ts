// Words what a project build reported: located problems as compiler-style lines and a missing LaTeX with its install hint.
import * as path from "node:path";

import type { LocatedProblem, ToolchainMissing } from "@labshelf/core";

/** `path:line: severity: message`, then the hint indented on the next line; paths are relative to `cwd` so editors can jump to them. */
export function problemLines(problems: readonly LocatedProblem[], projectFolder: string, cwd: string): string[] {
  return problems.flatMap((problem) => {
    const file = path.relative(cwd, path.resolve(projectFolder, problem.file));
    const where = problem.line === undefined ? file : `${file}:${problem.line}`;
    const line = `${where}: ${problem.severity}: ${problem.message}`;
    return problem.hint ? [line, `  ${problem.hint}`] : [line];
  });
}

export function toolchainMissingText(missing: ToolchainMissing): string {
  switch (missing.reason) {
    case "declined":
      return "No LaTeX found. Install TeX Live or run labshelf build in a terminal to install TinyTeX.\nIn CI, install TeX Live and set `engine:` in labshelf.yaml.";
    case "install-failed": return `Installing LaTeX failed: ${missing.message}`;
  }
}
