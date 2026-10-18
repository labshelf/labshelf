// Runs one `compile` request for a Typst project: installs Tinymist when missing, exports the PDF and sends the changed pages.
import * as path from "node:path";
import { mkdir } from "node:fs/promises";

import type { ILogger } from "../../../../ports/index.js";
import { PROTOCOL_VERSION, type HelperBuildStatus, type ToHelperMessage } from "../../index.js";
import type { LocatedProblem } from "../../../latex/build/index.js";

import type { HelperSend } from "../dispatch/index.js";
import { ensureTinymistBinary, type LspServers, type ManagedTinymist } from "../lsp/index.js";
import type { HelperProjects } from "../projects/index.js";
import { BUILD_MODULE, type BuildToken } from "./runBuildJob.js";
import { sendPages, type SentPages } from "./sendPages.js";
import { parseTinymistDiagnostics, scanTinymistDiagnostics } from "./tinymistDiagnostics.js";
import { exportTypst } from "./tinymistExport.js";

export interface TypstBuildJob {
  message: Extract<ToHelperMessage, { type: "compile" }>;
  send: HelperSend;
  token: BuildToken;
  dataDir: string;
  tinymist: ManagedTinymist;
  servers: Pick<LspServers, "start">;
  projects: Pick<HelperProjects, "syncWorkingCopy">;
  logger: ILogger;
  sent: SentPages;
}

const frame = { v: PROTOCOL_VERSION } as const;

function reply(job: TypstBuildJob, status: Exclude<HelperBuildStatus, "succeeded">, problems: LocatedProblem[] = []): void {
  job.send({ ...frame, id: job.message.id, type: "built", status, problems });
}

async function installBinary(job: TypstBuildJob): Promise<string | undefined> {
  const { message, send } = job;
  try {
    return await ensureTinymistBinary(job.tinymist, (text, fraction) => {
      send({ ...frame, id: message.id, type: "progress", phase: "installing-tinymist", message: text, ...(fraction !== undefined && { fraction }) });
    });
  } catch (error) {
    await job.logger.error(BUILD_MODULE, error, { projectId: message.projectId, main: message.main });
    reply(job, "toolchain-missing", [{ severity: "error", file: message.main, message: `The Typst compiler could not be installed: ${error instanceof Error ? error.message : String(error)}` }]);
    return undefined;
  }
}

/** Starting the language server is a courtesy for the editor; a build does not depend on it. */
async function startServer(job: TypstBuildJob): Promise<void> {
  try {
    await job.servers.start(job.message.projectId, job.message.id, job.send);
  } catch (error) {
    await job.logger.error(BUILD_MODULE, error, { projectId: job.message.projectId, step: "start language server" });
  }
}

export async function runTypstBuild(job: TypstBuildJob): Promise<void> {
  const { message, token, dataDir } = job;
  job.send({ ...frame, id: message.id, type: "progress", phase: "building", message: `Building ${message.main}` });
  const binary = await installBinary(job);
  if (!binary) { return; }
  if (token.cancelled) { return reply(job, "cancelled"); }
  const folder = path.join(dataDir, "projects", message.projectId, "src");
  const outPdf = path.join(dataDir, "projects", message.projectId, "build", "main.pdf");
  await job.projects.syncWorkingCopy(message.projectId, folder);
  await mkdir(path.dirname(outPdf), { recursive: true });
  await startServer(job);
  if (token.cancelled) { return reply(job, "cancelled"); }
  const result = await exportTypst(binary, folder, dataDir, message.main, outPdf, token);
  if (result.status === "cancelled") { return reply(job, "cancelled"); }
  if (result.code === 0) {
    return sendPages(message.id, outPdf, scanTinymistDiagnostics(result.stderr, folder), job.sent, job.send);
  }
  await job.logger.log("WARN", BUILD_MODULE, "Typst build failed", { projectId: message.projectId, main: message.main, code: result.code });
  reply(job, "failed", parseTinymistDiagnostics(result.stderr, folder, message.main));
}
