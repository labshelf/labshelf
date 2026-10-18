// Runs one `build` request to its `built` reply: finds TeX, builds, installs missing files and rebuilds, and streams the PDF.
import * as path from "node:path";

import { builtPdfPath, type ILogger, type LatexToolchain, type LocatedProblem, type ProjectEntry, type ProjectBuildResult } from "@labshelf/core";
import type { ProjectBuildQueue } from "@labshelf/core/node";
import { PROTOCOL_VERSION, type HelperBuildStatus, type ProgressPhase, type ToHelperMessage } from "@labshelf/core/helper";

import type { HelperSend } from "../dispatch/index.js";
import { pageProblems } from "./pageProblems.js";
import { sendBuiltPdf } from "./sendBuiltPdf.js";
import { classifyTexProblems, withToolchainOnPath, type TexProvider } from "./toolchain/index.js";

export const BUILD_MODULE = "helper/build";
const MAX_INSTALL_ROUNDS = 10;

/** Marks a build the page cancelled or replaced; the job checks it after every wait. */
export interface BuildToken { cancelled: boolean }

export interface BuildJob {
  message: Extract<ToHelperMessage, { type: "build" }>;
  send: HelperSend;
  token: BuildToken;
  queue: Pick<ProjectBuildQueue, "request">;
  project: Extract<ProjectEntry, { kind: "ready" }>;
  tex: TexProvider;
  logger: ILogger;
}

function progress(job: BuildJob, phase: ProgressPhase, message: string): void {
  job.send({ v: PROTOCOL_VERSION, id: job.message.id, type: "progress", phase, message });
}

function reply(job: BuildJob, status: Exclude<HelperBuildStatus, "succeeded">, problems: LocatedProblem[] = []): void {
  job.send({ v: PROTOCOL_VERSION, id: job.message.id, type: "built", status, problems });
}

async function prepareToolchain(job: BuildJob): Promise<LatexToolchain | "missing"> {
  const toolchain = await job.tex.resolve(job.message.engine);
  if (toolchain === "missing") { return toolchain; }
  // TRAP: core finds latexmk by name on PATH, and latexmk finds the engine the same way.
  process.env["PATH"] = withToolchainOnPath(toolchain, process.env);
  return toolchain;
}

/** Installs the file a failed build misses; true when the job should build again. */
async function installRound(job: BuildJob, fileName: string, round: number): Promise<boolean> {
  if (round > MAX_INSTALL_ROUNDS) {
    await job.logger.log("WARN", BUILD_MODULE, "Stopped installing missing files", { projectId: job.message.projectId, fileName, rounds: MAX_INSTALL_ROUNDS });
    return false;
  }
  progress(job, "installing-package", `Installing the TeX package that provides ${fileName}`);
  const installed = await job.tex.installMissing(fileName);
  await job.logger.log(installed ? "INFO" : "WARN", BUILD_MODULE, installed ? "Installed a missing TeX file" : "Could not install a missing TeX file", {
    projectId: job.message.projectId, fileName, round,
  });
  return installed;
}

async function finish(job: BuildJob, result: ProjectBuildResult, problems: LocatedProblem[], round: number): Promise<"retry" | "done"> {
  if (result.status === "succeeded") {
    await sendBuiltPdf(job.message.id, builtPdfPath(path, job.project)!, problems, job.send);
    return "done";
  }
  const { missingFile, shellEscape } = classifyTexProblems(problems);
  if (shellEscape) {
    reply(job, "needs-shell-escape", [{ severity: "error", message: shellEscape, file: job.message.main }, ...problems]);
    return "done";
  }
  if (missingFile && await installRound(job, missingFile, round) && !job.token.cancelled) { return "retry"; }
  if (job.token.cancelled) { reply(job, "cancelled"); } else { reply(job, "failed", problems); }
  return "done";
}

export async function runBuildJob(job: BuildJob): Promise<void> {
  const { message, token } = job;
  progress(job, "building", `Building ${message.main}`);
  const toolchain = await prepareToolchain(job);
  if (token.cancelled) { return reply(job, "cancelled"); }
  if (toolchain === "missing") { return reply(job, "toolchain-missing"); }
  for (let round = 1; ; round++) {
    // TRAP: latexmk does not rerun a failed build whose sources are unchanged, so a rebuild after an install is forced.
    const result = await job.queue.request(job.project, round > 1 ? { force: true } : {});
    if (token.cancelled || result.status === "cancelled") { return reply(job, "cancelled"); }
    if (result.status === "toolchain-missing") { return reply(job, "toolchain-missing"); }
    const problems = pageProblems("problems" in result ? result.problems : [], job.project.folder);
    if (await finish(job, result, problems, round) === "done") { return; }
  }
}
