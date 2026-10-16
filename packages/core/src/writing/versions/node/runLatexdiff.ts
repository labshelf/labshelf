// Runs latexdiff on two versions of a main file and returns the marked-up LaTeX source.
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { findExecutable } from "../../latex/toolchain/node/index.js";
import { runCancellable } from "../../latex/build/node/index.js";

export interface LatexdiffRequest {
  beforeMain: string;
  afterMain: string;
  /** Where latexdiff's stdout and stderr are kept. */
  outDir: string;
  signal: AbortSignal;
}

// Quotes one argument for the shell runCancellable starts: sh on Unix, cmd on Windows.
function quote(value: string): string {
  return process.platform === "win32" ? `"${value}"` : `'${value.replace(/'/g, "'\\''")}'`;
}

/** The last non-empty lines of a program's output, for an error message. */
export function outputTail(output: string, lines = 12): string {
  return output.split(/\r?\n/).filter((line) => line.trim() !== "").slice(-lines).join("\n");
}

/**
 * @returns the path of the written diff.tex
 * @throws when latexdiff is not installed or exits with an error; the message ends with its error output
 */
export async function runLatexdiff(request: LatexdiffRequest): Promise<string> {
  const latexdiff = await findExecutable("latexdiff");
  if (!latexdiff) { throw new Error("latexdiff is not installed. It comes with TeX Live."); }
  const diffTex = path.join(request.outDir, "diff.tex");
  const errorLog = path.join(request.outDir, "latexdiff.log");
  // TRAP: runCancellable keeps stdout and stderr interleaved and only the last 64 KiB, so piping stdout through it would
  // truncate or mix latexdiff's warnings into the document; the shell redirects keep each stream whole in its own file.
  const command = `${quote(latexdiff)} --flatten ${quote(request.beforeMain)} ${quote(request.afterMain)} > ${quote(diffTex)} 2> ${quote(errorLog)}`;
  await fs.mkdir(request.outDir, { recursive: true });
  const outcome = await runCancellable(command, [], path.dirname(request.afterMain), request.signal, { shell: true });
  if (outcome.code !== 0) {
    const stderr = await fs.readFile(errorLog, "utf8").catch(() => outcome.output);
    throw new Error(`latexdiff failed with exit code ${outcome.code ?? "none"}:\n${outputTail(stderr)}`);
  }
  return diffTex;
}
