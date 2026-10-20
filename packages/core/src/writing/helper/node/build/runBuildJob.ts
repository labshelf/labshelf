// Runs one `compile` request to its `built` reply: syncs the working copy, builds (core installs missing packages), classifies the failure and sends the changed pages.
import * as path from "node:path";

import { builtPdfPath } from "../../../build/index.js";
import { type ILogger } from "../../../../ports/index.js";
import { classifyTexProblems, type LocatedProblem } from "../../../latex/build/index.js";
import { type ProjectEntry } from "../../../project/index.js";
import type { ProjectBuildQueue } from "../../../build/node/index.js";
import { PROTOCOL_VERSION, type HelperBuildStatus, type ToHelperMessage } from "../../index.js";

import type { HelperSend } from "../dispatch/index.js";
import { pageProblems } from "./pageProblems.js";
import { sendPages, type SentPages } from "./sendPages.js";

export const BUILD_MODULE = "helper/build";

/** Marks a build the page cancelled or replaced; the job checks it after every wait. */
export interface BuildToken { cancelled: boolean }

export interface BuildJob {
  message: Extract<ToHelperMessage, { type: "compile" }>;
  send: HelperSend;
  token: BuildToken;
  queue: Pick<ProjectBuildQueue, "request">;
  project: Extract<ProjectEntry, { kind: "ready" }>;
  logger: ILogger;
  /** Brings the project's working copy up to date with its files and unsaved text. */
  sync(): Promise<void>;
  sent: SentPages;
}

function replier(job: BuildJob): (status: Exclude<HelperBuildStatus, "succeeded">, problems?: LocatedProblem[]) => void {
  return (status, problems = []) => job.send({ v: PROTOCOL_VERSION, id: job.message.id, type: "built", status, problems });
}

export async function runBuildJob(job: BuildJob): Promise<void> {
  const { message, token, send } = job;
  const reply = replier(job);
  const started = Date.now();
  send({ v: PROTOCOL_VERSION, id: message.id, type: "progress", phase: "building", message: `Building ${message.main}` });
  await job.sync();
  const synced = Date.now();
  if (token.cancelled) { return reply("cancelled"); }
  const options = { mode: message.mode, ...(message.editedFile !== undefined && { editedFile: message.editedFile }), ...(message.editedLine !== undefined && { editedLine: message.editedLine }), ...(message.haltOnError !== undefined && { haltOnError: message.haltOnError }) };
  const result = await job.queue.request(job.project, options);
  const compiled = Date.now();
  if (token.cancelled || result.status === "cancelled") { return reply("cancelled"); }
  if (result.status === "toolchain-missing") { return reply("toolchain-missing"); }
  const problems = pageProblems("problems" in result ? result.problems : [], job.project.folder);
  if (result.status === "succeeded") {
    await sendPages(message.id, builtPdfPath(path, job.project)!, problems, job.sent, send);
    await job.logger.log("INFO", BUILD_MODULE, "Build stages completed", {
      projectId: message.projectId, mode: message.mode, syncMs: synced - started,
      compileMs: compiled - synced, pagesMs: Date.now() - compiled,
    });
    return;
  }
  const { shellEscape } = classifyTexProblems(problems);
  if (shellEscape) { return reply("needs-shell-escape", [{ severity: "error", message: shellEscape, file: message.main }, ...problems]); }
  await job.logger.log("WARN", BUILD_MODULE, "Build failed", { projectId: message.projectId, main: message.main, status: result.status });
  reply("failed", problems);
}
