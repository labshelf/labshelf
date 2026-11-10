// The pure side of compiling LaTeX in the browser: the engine's compile options from the input map, and the diagnostics read from its log.
import { parseTexLog } from "@labshelf/core";

import type { BrowserCompileInput, BrowserDiagnostic } from "./compileTypes.js";

/** The options of one pdflatex run in texlyre-busytex (its PdfLatex.compile options). */
export interface BusytexCompile {
  /** The main file's text. */
  input: string;
  mainTexPath: string;
  additionalFiles: { path: string; content: Uint8Array }[];
  bibtex: boolean;
}

export function deriveBusytexCompile(input: BrowserCompileInput): BusytexCompile {
  const main = input.files.get(input.main);
  const additionalFiles = [...input.files].filter(([path]) => path !== input.main).map(([path, content]) => ({ path, content }));
  return {
    input: main ? new TextDecoder().decode(main) : "",
    mainTexPath: input.main,
    additionalFiles,
    bibtex: additionalFiles.some(({ path }) => /\.bib$/i.test(path)),
  };
}

// core's explanation of a missing .sty or .cls, which points at tlmgr; the browser engine cannot install anything.
const NOT_INSTALLED = /^(Package|Document class) "(.+)" is not installed\.$/;

/** The problems of the run's log (errors and warnings; core's notes are dropped), and one error when it made no PDF yet names none. */
export function deriveLatexDiagnostics(log: string, hasPdf: boolean): BrowserDiagnostic[] {
  const diagnostics: BrowserDiagnostic[] = [];
  for (const problem of parseTexLog(log, "pdflatex")) {
    if (problem.severity === "info") { continue; }
    const missing = NOT_INSTALLED.exec(problem.message);
    const message = missing
      ? `The LaTeX package ${missing[2]}.${missing[1] === "Package" ? "sty" : "cls"} is not available in the browser engine.`
      : problem.hint ? `${problem.message} ${problem.hint}` : problem.message;
    diagnostics.push({
      severity: problem.severity, message,
      ...(problem.file === undefined ? {} : { file: problem.file }),
      ...(problem.line === undefined ? {} : { line: problem.line }),
    });
  }
  if (!hasPdf && !diagnostics.some((d) => d.severity === "error")) {
    diagnostics.push({ severity: "error", message: "LaTeX stopped without a PDF and its log names no error." });
  }
  return diagnostics;
}
