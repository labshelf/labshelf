/** Runs LaTeX processes: any cancellable child process, and one LaTeX command whose log is read into problems located in project files. */
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { LatexBuildResult, LocatedProblem, BuildCommand } from "../build.js";
import { isFile } from "../../files/node/index.js";
import { readOptionalFile } from "../../library/node/index.js";
import { isInside } from "../../path/index.js";
import { nodePathOps } from "../../path/node/index.js";
import type { ILogger } from "../../ports/index.js";
import { extractBiberErrors } from "../biber.js";
import { parseTexLog, type BuildProblem } from "../log/index.js";
import { formatEngineLabel, type LatexToolchain } from "../toolchain.js";
import { withToolchainOnPath } from "./systemTex.js";

export interface RunOutcome {
  code: number | null;
  /** The tail of stdout and stderr, interleaved. */
  output: string;
}

const OUTPUT_LIMIT = 64 * 1024;

export interface CancellableOptions {
  /** Runs `executable` as a shell command line, with `args` empty. */
  shell?: boolean;
  /** Receives each chunk of stdout and stderr as it arrives. */
  onOutput?: (chunk: string) => void;
  /** The child's environment; the parent's when absent. */
  env?: NodeJS.ProcessEnv;
}

export class BuildCancelled extends Error {
  constructor() {
    super("The build was cancelled");
    this.name = "BuildCancelled";
  }
}

// PLATFORM: latexmk starts the engine as a child; killing latexmk alone leaves it writing to the build folder,
// so the whole process group (Unix) or tree (Windows) goes.
function killTree(pid: number): void {
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true }).on("error", () => undefined);
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    // The group already exited.
  }
}

export function runCancellable(
  executable: string, args: string[], cwd: string, signal: AbortSignal, options: CancellableOptions = {},
): Promise<RunOutcome> {
  if (signal.aborted) { return Promise.reject(new BuildCancelled()); }
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd, env: options.env ?? process.env, shell: options.shell ?? false, detached: process.platform !== "win32", windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const collect = (chunk: Buffer): void => {
      const text = chunk.toString("utf8");
      output = (output + text).slice(-OUTPUT_LIMIT);
      options.onOutput?.(text);
    };
    const onAbort = (): void => { if (child.pid !== undefined) { killTree(child.pid); } };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    signal.addEventListener("abort", onAbort, { once: true });
    child.on("error", (error) => {
      signal.removeEventListener("abort", onAbort);
      reject(error);
    });
    child.on("close", (code) => {
      signal.removeEventListener("abort", onAbort);
      if (signal.aborted) { reject(new BuildCancelled()); } else { resolve({ code, output }); }
    });
  });
}

export interface ProblemPlaces {
  projectFolder: string;
  /** The folder the build ran in; log paths are relative to it. */
  workDir: string;
  mainFile: string;
}

async function projectFile(logPath: string, places: ProblemPlaces): Promise<string | undefined> {
  const absolute = path.resolve(places.workDir, logPath);
  return isInside(nodePathOps, places.projectFolder, absolute) && await isFile(absolute) ? absolute : undefined;
}

/** A problem in a file outside the project (a package, a class) goes on the main file, named after that file. */
export async function findProblems(problems: readonly BuildProblem[], places: ProblemPlaces): Promise<LocatedProblem[]> {
  return Promise.all(problems.map(async ({ file, line, ...rest }): Promise<LocatedProblem> => {
    const located = file ? await projectFile(file, places) : undefined;
    if (located) { return line === undefined ? { ...rest, file: located } : { ...rest, file: located, line }; }
    const message = file ? `${path.basename(file)}: ${rest.message}` : rest.message;
    return { ...rest, message, file: places.mainFile };
  }));
}

// PLATFORM: latexmk prints this line when the `$biber` command exits non-zero.
const BIBER_FAILED = "Latexmk: Error return from 'biber ";

/** Empty when biber did not fail in this run. */
export async function findBiberProblems(output: string, outDir: string, job: string, mainFile: string): Promise<LocatedProblem[]> {
  if (!output.includes(BIBER_FAILED)) { return []; }
  const blg = (await readOptionalFile(path.join(outDir, `${job}.blg`))) ?? "";
  const errors = extractBiberErrors(blg);
  const messages = errors.length > 0 ? errors : extractBiberErrors(output);
  return (messages.length > 0 ? messages : [`see ${job}.blg`]).map((message) => ({ severity: "error", message: `Biber: ${message}`, file: mainFile }));
}

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
