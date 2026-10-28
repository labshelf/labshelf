// Runs the helper's builds: the `compile` and `cancel` handlers, one build job to its `built` reply, the changed pages it compares and sends and the TeX setup answers it gives.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import * as path from "node:path";

import type { ILogger } from "../../ports/index.js";
import { deriveTexProblemClass, type LocatedProblem } from "../../latex/index.js";
import type { ManagedTexProvider } from "../../latex/node/index.js";
import { deriveBuiltPdfPath, type TexSetupAsk } from "../../writing/build/index.js";
import { ProjectBuildQueue, type ProjectBuildDeps } from "../../writing/build/node/index.js";
import type { ProjectEntry } from "../../writing/project/index.js";
import { formatError } from "../../errors/index.js";
import {
  MAX_SOCKET_MESSAGE_BYTES, PROTOCOL_VERSION, type ChangedPage, type HelperBuildState, type ToHelperMessage,
} from "../index.js";
import { singlePage } from "../pageMerge.js";

import type { HelperHandler, HelperSend } from "./helperHandlers.js";
import { HelperProjectError, type HelperProjects } from "./helperProjects.js";

const BUILD_MODULE = "helper/build";

// --- Page comparison: splits a PDF into one-page PDFs and reports the pages whose content differs from earlier hashes ---

export interface PageDiff {
  pageCount: number;
  hashes: string[];
  changed: { index: number; bytes: Uint8Array }[];
}

export async function comparePages(previousHashes: readonly string[], pdf: Uint8Array): Promise<PageDiff> {
  const source = await PDFDocument.load(pdf, { updateMetadata: false });
  const pageCount = source.getPageCount();
  const hashes: string[] = [];
  const changed: PageDiff["changed"] = [];
  for (let index = 0; index < pageCount; index += 1) {
    const bytes = await singlePage(source, index);
    const hash = createHash("sha256").update(bytes).digest("hex");
    hashes.push(hash);
    if (previousHashes[index] !== hash) { changed.push({ index, bytes }); }
  }
  return { pageCount, hashes, changed };
}

// --- TeX setup answers: the helper never installs TeX and reports package installs as progress ---

/** The page shows its own TeX setup on `toolchain-missing`, so the helper declines the install. */
export function createHelperToolchainAsk(id: string, send: HelperSend): TexSetupAsk {
  const report = (message: string): void => send({ v: PROTOCOL_VERSION, id, type: "progress", phase: "installing-package", message });
  return {
    chooseInstall: () => Promise.resolve(undefined),
    progress: (title, run) => {
      report(title);
      return run((message) => { if (message) { report(`${title}: ${message}`); } });
    },
  };
}

// --- Pages: `built` with the PDF's SHA-256, then `pages` with the one-page PDFs that changed since the last send ---

/** The hashes of the pages last sent for one project; the next `pages` carries only the pages that differ. */
export interface SentPages { hashes: string[]; pdfSha256?: string }

// CONTRACT: documents/contracts/helper.md#messages
const LENGTH_PREFIX_BYTES = 4;

/** @throws limit when the changed pages would not fit one socket message */
export async function sendPages(id: string, pdfPath: string, problems: LocatedProblem[], sent: SentPages, send: HelperSend): Promise<void> {
  const bytes = await readFile(pdfPath);
  const pdfSha256 = createHash("sha256").update(bytes).digest("hex");
  const diff = sent.pdfSha256 === pdfSha256
    ? { pageCount: sent.hashes.length, hashes: sent.hashes, changed: [] }
    : await comparePages(sent.hashes, bytes);
  let offset = 0;
  const changed = diff.changed.map(({ index, bytes: page }): ChangedPage => {
    const entry = { index, offset, length: page.length };
    offset += page.length;
    return entry;
  });
  const pages = { v: PROTOCOL_VERSION, id, type: "pages", pdfSha256, pageCount: diff.pageCount, changed } as const;
  const messageBytes = LENGTH_PREFIX_BYTES + Buffer.byteLength(JSON.stringify(pages)) + offset;
  if (messageBytes > MAX_SOCKET_MESSAGE_BYTES) {
    throw new HelperProjectError("limit", `The changed pages take ${messageBytes} bytes, over the ${MAX_SOCKET_MESSAGE_BYTES / (1024 * 1024)} MiB message limit`);
  }
  send({ v: PROTOCOL_VERSION, id, type: "built", status: "succeeded", problems, pdfSha256 });
  send(pages, Buffer.concat(diff.changed.map((page) => page.bytes)));
  sent.hashes = diff.hashes;
  sent.pdfSha256 = pdfSha256;
}

// --- One build job: syncs the working copy, builds (core installs missing packages), classifies the failure and sends the changed pages ---

// CONTRACT: documents/contracts/helper.md#messages
function pageProblems(problems: readonly LocatedProblem[], sourceDir: string): LocatedProblem[] {
  return problems.map((problem) => ({ ...problem, file: path.relative(sourceDir, problem.file).split(path.sep).join("/") }));
}

/** Marks a build the page cancelled or replaced; the job checks it after every wait. */
interface BuildToken { cancelled: boolean }

interface BuildJob {
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

function replier(job: BuildJob): (status: Exclude<HelperBuildState, "succeeded">, problems?: LocatedProblem[]) => void {
  return (status, problems = []) => job.send({ v: PROTOCOL_VERSION, id: job.message.id, type: "built", status, problems });
}

async function runBuildJob(job: BuildJob): Promise<void> {
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
    await sendPages(message.id, deriveBuiltPdfPath(path, job.project)!, problems, job.sent, send);
    await job.logger.log("INFO", BUILD_MODULE, "Build stages completed", {
      projectId: message.projectId, mode: message.mode, syncMs: synced - started,
      compileMs: compiled - synced, pagesMs: Date.now() - compiled,
    });
    return;
  }
  const { shellEscape } = deriveTexProblemClass(problems);
  if (shellEscape) { return reply("needs-shell-escape", [{ severity: "error", message: shellEscape, file: message.main }, ...problems]); }
  await job.logger.log("WARN", BUILD_MODULE, "Build failed", { projectId: message.projectId, main: message.main, status: result.status });
  reply("failed", problems);
}

// --- Handlers: one build queue per project, and a token per build that a cancel or a newer build trips ---

export interface BuildHandlerOptions {
  /** The helper's data folder; each project builds in `projects/<id>/src` and `projects/<id>/build`. */
  dataDir: string;
  projects: Pick<HelperProjects, "syncWorkingCopy">;
  tex: ManagedTexProvider;
  /** Opens the one Typst compiler every project builds with; its font download reports through `withFontDownload`. */
  openTypst(withFontDownload: <T>(run: () => Promise<T>) => Promise<T>): ProjectBuildDeps["typst"];
  logger: ILogger;
  /** Starts the helper's `--biber` mode, for latexmk's `$biber`. */
  biber?: readonly string[];
}

export interface BuildHandlers {
  compile: HelperHandler;
  cancel: HelperHandler;
  cancelAll(): void;
  /** Stops the project's build and drops the pages sent for it, so its next `pages` carries every page. */
  forget(projectId: string): void;
}

interface ProjectBuilds { deps: ProjectBuildDeps; queue: ProjectBuildQueue; sent: SentPages; token?: BuildToken }

type CompileMessage = Extract<ToHelperMessage, { type: "compile" }>;

const FONT_DOWNLOAD = "Downloading Typst's default fonts (9 MB, once)";

function reportFontDownload(latest: { id: string; send: HelperSend } | undefined): void {
  latest?.send({ v: PROTOCOL_VERSION, id: latest.id, type: "progress", phase: "building", message: FONT_DOWNLOAD });
}

function createProjectBuilds(options: BuildHandlerOptions, typst: ProjectBuildDeps["typst"], prompt: TexSetupAsk): ProjectBuilds {
  const deps: ProjectBuildDeps = {
    logger: options.logger, tex: options.tex, prompt,
    projects: { projectBuildDir: (id) => path.join(options.dataDir, "projects", id, "build") },
    typst, ...(options.biber && { biber: options.biber }),
  };
  return { deps, queue: new ProjectBuildQueue(deps), sent: { hashes: [] } };
}

async function reportFailure(options: BuildHandlerOptions, message: CompileMessage, send: HelperSend, error: unknown): Promise<void> {
  await options.logger.error(BUILD_MODULE, error, { projectId: message.projectId, main: message.main });
  const code = error instanceof HelperProjectError ? error.code : "internal";
  send({ v: PROTOCOL_VERSION, id: message.id, type: "error", code, message: formatError(error) });
}

async function runInBackground(options: BuildHandlerOptions, message: CompileMessage, send: HelperSend, builds: ProjectBuilds, token: BuildToken): Promise<void> {
  const { logger } = options;
  try {
    const folder = path.join(options.dataDir, "projects", message.projectId, "src");
    // The page owns the project settings; the engine comes with each build, and the main file's extension picks the format.
    const settings = { id: message.projectId, format: message.main.endsWith(".typ") ? "typst" as const : "latex" as const, engine: message.engine };
    const project = { kind: "ready" as const, folder, location: "external" as const, settings, main: message.main };
    const sync = (): Promise<void> => options.projects.syncWorkingCopy(message.projectId, folder);
    await runBuildJob({ message, send, token, queue: builds.queue, project, logger, sync, sent: builds.sent });
  } catch (error) {
    await reportFailure(options, message, send, error);
  } finally {
    if (builds.token === token) { delete builds.token; }
  }
}

export function createBuildHandlers(options: BuildHandlerOptions): BuildHandlers {
  const { logger } = options;
  const projects = new Map<string, ProjectBuilds>();
  // INVARIANT: the compiler opens once for every project, so its font download reports to the latest compile.
  let latest: { id: string; send: HelperSend } | undefined;
  const typst = options.openTypst((run) => { reportFontDownload(latest); return run(); });

  function buildsOf(projectId: string, prompt: TexSetupAsk): ProjectBuilds {
    let builds = projects.get(projectId);
    if (!builds) {
      builds = createProjectBuilds(options, typst, prompt);
      projects.set(projectId, builds);
    }
    // INVARIANT: the queue runs only its latest request, which is this one, so the prompt it reads reports to this build's id.
    builds.deps.prompt = prompt;
    return builds;
  }

  function stop(builds: ProjectBuilds | undefined): void {
    if (!builds?.token) { return; }
    builds.token.cancelled = true;
    builds.queue.cancelAll();
  }

  // INVARIANT: the token is registered before any await, because the dispatcher runs a `cancel` without waiting for this build.
  const compile: HelperHandler = (message, send) => {
    if (message.type !== "compile") { throw new Error(`compile handler received ${message.type}`); }
    latest = { id: message.id, send };
    const builds = buildsOf(message.projectId, createHelperToolchainAsk(message.id, send));
    stop(builds);
    const token: BuildToken = { cancelled: false };
    builds.token = token;
    void runInBackground(options, message, send, builds, token);
    return Promise.resolve();
  };

  const cancel: HelperHandler = async (message) => {
    if (message.type !== "cancel") { throw new Error(`cancel handler received ${message.type}`); }
    const builds = projects.get(message.projectId);
    await logger.log("INFO", BUILD_MODULE, builds?.token ? "Cancelling the running build" : "Cancel with no running build", { projectId: message.projectId });
    stop(builds);
  };

  return {
    compile,
    cancel,
    cancelAll: () => { for (const builds of projects.values()) { stop(builds); } },
    forget: (projectId) => { stop(projects.get(projectId)); projects.delete(projectId); },
  };
}
