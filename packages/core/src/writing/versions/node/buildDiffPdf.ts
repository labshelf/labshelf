// Builds a PDF of a LaTeX project that marks what changed between two versions of its sources, using latexdiff.
import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { ILogger } from "../../../ports/index.js";
import { createLatexBuildCommand } from "../../../latex/build/index.js";
import { runCancellable } from "../../../latex/build/node/index.js";
import type { LatexToolchain } from "../../../latex/toolchain.js";
import { findExecutable } from "../../../latex/node/index.js";

interface LatexdiffRequest {
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
function outputTail(output: string, lines = 12): string {
  return output.split(/\r?\n/).filter((line) => line.trim() !== "").slice(-lines).join("\n");
}

/**
 * @returns the path of the written diff.tex
 * @throws when latexdiff is not installed or exits with an error; the message ends with its error output
 */
async function runLatexdiff(request: LatexdiffRequest): Promise<string> {
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

const MODULE = "writing/versions";

export interface DiffRequest {
  /** The sources of the older side. */
  beforeDir: string;
  /** The sources of the newer side; the diff compiles with its folder as the working directory. */
  afterDir: string;
  /** The main file, relative to both folders. */
  main: string;
  /** Receives diff.tex, the build files and diff.pdf. */
  outDir: string;
  toolchain: LatexToolchain;
  signal: AbortSignal;
}

async function compileDiff(request: DiffRequest, diffTex: string): Promise<string> {
  // The working directory is the newer sources' folder so the relative \includegraphics and \input paths that
  // latexdiff leaves in place resolve as in the project's own build.
  const cwd = path.dirname(path.join(request.afterDir, request.main));
  const command = createLatexBuildCommand(request.toolchain, diffTex, request.outDir);
  const outcome = await runCancellable(command.executable, command.args, cwd, request.signal, { env: { ...process.env, ...command.env } });
  const pdf = path.join(request.outDir, "diff.pdf");
  if (outcome.code === 0 && await fs.stat(pdf).then(() => true, () => false)) { return pdf; }
  throw new Error(`The marked-up PDF did not compile (exit code ${outcome.code ?? "none"}):\n${outputTail(outcome.output)}`);
}

/**
 * @returns the path of diff.pdf in `outDir`
 * @throws when latexdiff or the LaTeX build fails or is cancelled; the message carries the tail of the failing tool's output
 */
export async function buildMarkedUpDiff(request: DiffRequest, logger: ILogger): Promise<string> {
  const started = Date.now();
  const context = { beforeDir: request.beforeDir, afterDir: request.afterDir, main: request.main, outDir: request.outDir };
  await logger.log("INFO", MODULE, "Building a marked-up PDF with latexdiff", context);
  try {
    const diffTex = await runLatexdiff({
      beforeMain: path.join(request.beforeDir, request.main),
      afterMain: path.join(request.afterDir, request.main),
      outDir: request.outDir,
      signal: request.signal,
    });
    const pdf = await compileDiff(request, diffTex);
    await logger.log("INFO", MODULE, "Built a marked-up PDF", { ...context, pdf, ms: Date.now() - started });
    return pdf;
  } catch (error) {
    await logger.log("WARN", MODULE, "Could not build a marked-up PDF", { ...context, error: String(error) });
    throw error;
  }
}
