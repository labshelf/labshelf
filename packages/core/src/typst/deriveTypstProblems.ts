/** Turns the Typst compiler's diagnostics into build problems on project files. */
import type { BuildProblem } from "../latex/index.js";

/** A diagnostic as typst.ts reports it with `diagnostics: "full"`. */
export interface TypstCompilerProblem {
  /** `namespace/name:version` when the diagnostic is inside a package, else empty. */
  package: string;
  path: string;
  severity: string;
  /** `startLine:startColumn-endLine:endColumn`, zero-based; empty when the diagnostic has no span. */
  range: string;
  message: string;
}

function startLine(range: string): number | undefined {
  const match = /^(\d+):\d+/.exec(range);
  return match ? Number(match[1]) + 1 : undefined;
}

/** `resolvePath` maps a compiler path to a file path; a problem inside a package is placed on `mainFile`.
 * Hints are dropped: they are call traces ("import") that point at the line already shown with the error. */
export function deriveTypstProblems(
  diagnostics: readonly TypstCompilerProblem[],
  mainFile: string,
  resolvePath: (compilerPath: string) => string,
): (BuildProblem & { file: string })[] {
  return diagnostics.filter((diagnostic) => diagnostic.severity === "error" || diagnostic.severity === "warning").map((diagnostic) => {
    const severity = diagnostic.severity === "error" ? "error" : "warning";
    if (diagnostic.package !== "" || diagnostic.path === "") {
      const where = diagnostic.package === "" ? "" : ` (in package ${diagnostic.package})`;
      return { severity, message: `${diagnostic.message}${where}`, file: mainFile };
    }
    const line = startLine(diagnostic.range);
    return { severity, message: diagnostic.message, file: resolvePath(diagnostic.path), ...(line === undefined ? {} : { line }) };
  });
}
