// Parses the diagnostics Tinymist prints on stderr into problems located in the project's files.
import * as path from "node:path";

import type { LocatedProblem } from "../../../latex/build/index.js";

const DIAGNOSTIC = /^(error|warning): (.*)\n\s*┌─ (.+):(\d+):\d+/gm;

/** The diagnostics stderr names, with paths relative to the working copy. */
export function scanTinymistDiagnostics(stderr: string, sourceDir: string): LocatedProblem[] {
  return [...stderr.matchAll(DIAGNOSTIC)].map(([, severity, message, file, line]): LocatedProblem => ({
    severity: severity as "error" | "warning",
    message: message!,
    file: (path.isAbsolute(file!) ? path.relative(sourceDir, file!) : file!).split(path.sep).join("/"),
    line: Number(line),
  }));
}

/** Falls back to one error carrying the whole stderr when no diagnostic parses, so a failure never reads as empty. */
export function parseTinymistDiagnostics(stderr: string, sourceDir: string, main: string): LocatedProblem[] {
  const problems = scanTinymistDiagnostics(stderr, sourceDir);
  if (problems.length > 0) { return problems; }
  return [{ severity: "error", file: main, message: stderr.trim() || "Typst compilation failed" }];
}
