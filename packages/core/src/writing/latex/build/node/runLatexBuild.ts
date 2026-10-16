/** Compiles a LaTeX project into its build folder and puts the PDF next to the main file only when the build succeeds. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { readOptionalFile, writeFileAtomic } from "../../../../library/node/index.js";
import type { ILogger } from "../../../../ports/index.js";
import { parseTexLog } from "../../log/index.js";
import { engineLabel, type LatexToolchain } from "../../toolchain/index.js";
import { latexBuildCommand } from "../latexBuildCommand.js";
import { locateProblems, type LocatedProblem, type ProblemPlaces } from "./locateProblems.js";
import { BuildCancelled, runCancellable } from "./runCancellable.js";

export interface LatexBuildRequest {
  toolchain: LatexToolchain;
  projectFolder: string;
  /** The main file, relative to the project folder. */
  main: string;
  /** Receives every file the build writes except the final PDF. */
  outDir: string;
  signal: AbortSignal;
  logger: ILogger;
}

export type LatexBuildResult =
  | { status: "cancelled" }
  | { status: "succeeded"; pdf: string; problems: LocatedProblem[] }
  | { status: "failed"; problems: LocatedProblem[] };

const MODULE = "writing/build";
// Tectonic's own summary lines say only that TeX failed; the cause is in the log or in another "error:" line.
const TECTONIC_SUMMARY = /something bad happened inside|unrecoverable error|^error: halted on/;

/** The reason a run failed when its log names no error: a network failure, a crash, a missing engine. */
function failureReason(output: string, request: LatexBuildRequest, code: number | null): string {
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== "");
  const errorLine = lines.find((line) => line.startsWith("error:") && !TECTONIC_SUMMARY.test(line));
  if (errorLine) { return errorLine.replace(/^error:\s*/, ""); }
  return `${engineLabel(request.toolchain.engine)} stopped with exit code ${code ?? "none"}: ${lines.at(-1) ?? "no output"}`;
}

async function compile(request: LatexBuildRequest, places: ProblemPlaces, base: string): Promise<LatexBuildResult> {
  const command = latexBuildCommand(request.toolchain, path.basename(request.main), request.outDir);
  let outcome;
  try {
    outcome = await runCancellable(command.executable, command.args, places.workDir, request.signal);
  } catch (error) {
    if (error instanceof BuildCancelled) { return { status: "cancelled" }; }
    await request.logger.error(MODULE, error, { executable: command.executable, main: request.main });
    return { status: "failed", problems: [{ severity: "error", message: `Could not start ${command.executable}: ${String(error)}`, file: places.mainFile }] };
  }
  const log = (await readOptionalFile(path.join(request.outDir, `${base}.log`))) ?? "";
  const problems = await locateProblems(parseTexLog(log, request.toolchain.engine), places);
  const builtPdf = path.join(request.outDir, `${base}.pdf`);
  if (outcome.code === 0 && await fs.stat(builtPdf).then(() => true, () => false)) {
    const pdf = path.join(places.workDir, `${base}.pdf`);
    await writeFileAtomic(pdf, await fs.readFile(builtPdf));
    return { status: "succeeded", pdf, problems };
  }
  if (!problems.some((problem) => problem.severity === "error")) {
    problems.unshift({ severity: "error", message: failureReason(outcome.output, request, outcome.code), file: places.mainFile });
  }
  return { status: "failed", problems };
}

export async function runLatexBuild(request: LatexBuildRequest): Promise<LatexBuildResult> {
  const mainFile = path.join(request.projectFolder, request.main);
  const places: ProblemPlaces = { projectFolder: request.projectFolder, workDir: path.dirname(mainFile), mainFile };
  const base = path.basename(request.main, path.extname(request.main));
  const started = Date.now();
  await fs.mkdir(request.outDir, { recursive: true });
  const result = await compile(request, places, base);
  const errors = result.status === "cancelled" ? 0 : result.problems.filter((problem) => problem.severity === "error").length;
  await request.logger.log(result.status === "failed" ? "WARN" : "INFO", MODULE, `LaTeX build ${result.status}`, {
    main: mainFile, engine: request.toolchain.engine, outDir: request.outDir, errors, ms: Date.now() - started,
  });
  return result;
}
