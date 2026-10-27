/** Runs one LaTeX command and reads its log into located problems and, when it succeeds, the PDF it wrote in the build folder. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { readOptionalFile } from "../../../library/node/index.js";
import type { ILogger } from "../../../ports/index.js";
import { parseTexLog, type BuildProblem } from "../../log/index.js";
import { formatEngineLabel, type LatexToolchain } from "../../toolchain.js";
import type { LatexBuildResult } from "../buildResult.js";
import type { BuildCommand } from "../createLatexBuildCommand.js";
import { withToolchainOnPath } from "../../node/systemTex.js";
import { findBiberProblems } from "./findBiberProblems.js";
import { findProblems, type ProblemPlaces } from "./findProblems.js";
import { BuildCancelled, runCancellable } from "./runCancellable.js";

export interface CompileRequest {
  toolchain: LatexToolchain;
  outDir: string;
  signal: AbortSignal;
  logger: ILogger;
}

export interface LatexBuildJob {
  /** The job name: the run writes `<job>.log` and `<job>.pdf` into the build folder. */
  job: string;
  command: BuildCommand;
  /** Moves problems of a generated document onto the source lines they came from, before they are located. */
  mapProblems?: (problems: BuildProblem[]) => BuildProblem[];
}

const MODULE = "writing/build";

/** The reason a run failed when its log names no error: a crash or a missing engine. */
function failureReason(output: string, engine: LatexToolchain["engine"], code: number | null): string {
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== "");
  return `${formatEngineLabel(engine)} stopped with exit code ${code ?? "none"}: ${lines.at(-1) ?? "no output"}`;
}

/** A succeeded result's `pdf` is the build folder's copy; publishing it next to main is the caller's step. */
export async function buildLatexProject(request: CompileRequest, places: ProblemPlaces, { job, command, mapProblems }: LatexBuildJob): Promise<LatexBuildResult> {
  let outcome;
  try {
    outcome = await runCancellable(command.executable, command.args, places.workDir, request.signal, { env: { ...withToolchainOnPath(request.toolchain, process.env), ...command.env } });
  } catch (error) {
    if (error instanceof BuildCancelled) { return { status: "cancelled" }; }
    await request.logger.error(MODULE, error, { executable: command.executable, main: places.mainFile, job });
    return { status: "failed", problems: [{ severity: "error", message: `Could not start ${command.executable}: ${String(error)}`, file: places.mainFile }] };
  }
  const log = (await readOptionalFile(path.join(request.outDir, `${job}.log`))) ?? "";
  const parsed = parseTexLog(log, request.toolchain.engine);
  const problems = await findProblems(mapProblems ? mapProblems(parsed) : parsed, places);
  const pdf = path.join(request.outDir, `${job}.pdf`);
  if (outcome.code === 0 && await fs.stat(pdf).then(() => true, () => false)) { return { status: "succeeded", pdf, problems }; }
  const biber = await findBiberProblems(outcome.output, request.outDir, job, places.mainFile);
  if (biber.length > 0) {
    await request.logger.log("WARN", MODULE, "Biber failed", { main: places.mainFile, job, errors: biber.map((problem) => problem.message) });
    problems.unshift(...biber);
  }
  if (!problems.some((problem) => problem.severity === "error")) {
    problems.unshift({ severity: "error", message: failureReason(outcome.output, request.toolchain.engine, outcome.code), file: places.mainFile });
  }
  return { status: "failed", problems };
}
