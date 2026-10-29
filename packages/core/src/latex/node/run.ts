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
import { extractBiberErrors } from "../biber/index.js";
import { parseTexLog, type BuildProblem } from "../log.js";
import { formatEngineLabel, type LatexToolchain } from "../toolchain.js";
import { withToolchainOnPath } from "./systemTex.js";

export interface RunOutcome {
  code: number | null;
  /** The tail of stdout and stderr, interleaved. */
  output: string;
  /** The tail of stdout alone; present only with `separateStreams`. */
  stdout?: string;
  /** The tail of stderr alone; present only with `separateStreams`. */
  stderr?: string;
}

const OUTPUT_LIMIT = 64 * 1024;
const DEFAULT_KILL_GRACE_MS = 2000;
const MODULE_RUN = "process/run";

export interface CancellableOptions {
  /** Runs `executable` as a shell command line, with `args` empty. */
  shell?: boolean;
  /** Receives each chunk of stdout and stderr as it arrives. */
  onOutput?: (chunk: string) => void;
  /** The child's environment; the parent's when absent. */
  env?: NodeJS.ProcessEnv;
  /** Ends the run with SIGTERM to the process group after this long; no limit when absent. */
  timeoutMs?: number;
  /** How long a child may ignore SIGTERM before its group gets SIGKILL; 2000 when absent. */
  killGraceMs?: number;
  /** Keeps a tail of stdout and of stderr apart, besides the merged `output`. */
  separateStreams?: boolean;
  /** Receives the timeout and each escalation to SIGKILL. */
  logger?: ILogger;
}

export class BuildCancelled extends Error {
  constructor() {
    super("The build was cancelled");
    this.name = "BuildCancelled";
  }
}

export class ProcessTimedOut extends Error {
  constructor(timeoutMs: number) {
    super(`The process timed out after ${timeoutMs} ms`);
    this.name = "ProcessTimedOut";
  }
}

// PLATFORM: latexmk starts the engine as a child; killing latexmk alone leaves it writing to the build folder,
// so the whole process group (Unix) or tree (Windows) goes.
function killTree(pid: number, signal: "SIGTERM" | "SIGKILL"): void {
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true }).on("error", () => undefined);
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch {
    // The group already exited.
  }
}

interface OutputTail {
  collect: (kind: "stdout" | "stderr") => (chunk: Buffer) => void;
  outcome: (code: number | null) => RunOutcome;
}

/** Keeps the last OUTPUT_LIMIT characters of the merged output and, with `separateStreams`, of each stream. */
function createOutputTail(separateStreams: boolean, onOutput: ((chunk: string) => void) | undefined): OutputTail {
  let output = "";
  let stdout = "";
  let stderr = "";
  return {
    collect: (kind) => (chunk) => {
      const text = chunk.toString("utf8");
      output = (output + text).slice(-OUTPUT_LIMIT);
      if (separateStreams) {
        if (kind === "stdout") { stdout = (stdout + text).slice(-OUTPUT_LIMIT); } else { stderr = (stderr + text).slice(-OUTPUT_LIMIT); }
      }
      onOutput?.(text);
    },
    outcome: (code) => (separateStreams ? { code, output, stdout, stderr } : { code, output }),
  };
}

interface KillSwitch {
  /** SIGTERM to the group; a group still open after the grace period gets SIGKILL, grandchildren included. */
  terminate: () => void;
  timedOut: () => boolean;
  /** Marks the child closed and clears both timers. */
  close: () => void;
}

interface KillSwitchOptions {
  timeoutMs: number | undefined;
  graceMs: number;
  note: (message: string) => void;
}

function createKillSwitch(child: { readonly pid?: number | undefined }, { timeoutMs, graceMs, note }: KillSwitchOptions): KillSwitch {
  let closed = false;
  let timedOut = false;
  let timeoutTimer: NodeJS.Timeout | undefined;
  let graceTimer: NodeJS.Timeout | undefined;
  const terminate = (): void => {
    if (child.pid === undefined || closed) { return; }
    const pid = child.pid;
    killTree(pid, "SIGTERM");
    graceTimer ??= setTimeout(() => {
      if (closed) { return; }
      note("The process ignored SIGTERM; sending SIGKILL");
      killTree(pid, "SIGKILL");
    }, graceMs);
  };
  if (timeoutMs !== undefined) {
    timeoutTimer = setTimeout(() => {
      if (closed) { return; }
      timedOut = true;
      note("The process timed out; sending SIGTERM");
      terminate();
    }, timeoutMs);
  }
  return {
    terminate,
    timedOut: () => timedOut,
    close: () => {
      closed = true;
      clearTimeout(timeoutTimer);
      clearTimeout(graceTimer);
    },
  };
}

export function runCancellable(
  executable: string, args: string[], cwd: string, signal: AbortSignal, options: CancellableOptions = {},
): Promise<RunOutcome> {
  if (signal.aborted) { return Promise.reject(new BuildCancelled()); }
  const { timeoutMs, logger, separateStreams = false } = options;
  const graceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd, env: options.env ?? process.env, shell: options.shell ?? false, detached: process.platform !== "win32", windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    });
    const tail = createOutputTail(separateStreams, options.onOutput);
    const note = (message: string): void => {
      void logger?.log("WARN", MODULE_RUN, message, { executable, pid: child.pid, timeoutMs, killGraceMs: graceMs }).catch(() => undefined);
    };
    child.stdout.on("data", tail.collect("stdout"));
    child.stderr.on("data", tail.collect("stderr"));
    const onAbort = (): void => { kill.terminate(); };
    signal.addEventListener("abort", onAbort, { once: true });
    const kill = createKillSwitch(child, { timeoutMs, graceMs, note });
    const cleanup = (): void => {
      kill.close();
      signal.removeEventListener("abort", onAbort);
    };
    child.on("error", (error) => {
      cleanup();
      reject(error);
    });
    child.on("close", (code) => {
      cleanup();
      if (signal.aborted) { reject(new BuildCancelled()); }
      else if (kill.timedOut()) { reject(new ProcessTimedOut(timeoutMs ?? 0)); }
      else { resolve(tail.outcome(code)); }
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
