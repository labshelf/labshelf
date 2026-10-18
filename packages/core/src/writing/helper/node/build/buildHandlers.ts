// Creates the `compile` and `cancel` handlers: one build queue per project, and a token per build that a cancel or a newer build trips.
import * as path from "node:path";

import type { ILogger } from "../../../../ports/index.js";
import { ProjectBuildQueue, type ProjectBuildDeps } from "../../../build/node/index.js";
import type { TexSetupPrompt } from "../../../build/index.js";
import type { ManagedTexProvider } from "../../../latex/toolchain/node/managed/index.js";
import { PROTOCOL_VERSION, type ToHelperMessage } from "../../index.js";

import type { HelperHandler, HelperSend } from "../dispatch/index.js";
import type { LspServers, ManagedTinymist } from "../lsp/index.js";
import { HelperProjectError, type HelperProjects } from "../projects/index.js";
import { BUILD_MODULE, runBuildJob, type BuildToken } from "./runBuildJob.js";
import { helperToolchainPrompt } from "./helperToolchainPrompt.js";
import type { SentPages } from "./sendPages.js";
import { runTypstBuild } from "./typstBuild.js";

export interface BuildHandlerOptions {
  /** The helper's data folder; each project builds in `projects/<id>/src` and `projects/<id>/build`. */
  dataDir: string;
  projects: Pick<HelperProjects, "syncWorkingCopy">;
  tex: ManagedTexProvider;
  /** Builds Typst projects: the managed Tinymist exports the PDF. */
  tinymist: ManagedTinymist;
  /** A Typst build starts the project's language server, so the editor's first request finds it running. */
  servers: Pick<LspServers, "start">;
  logger: ILogger;
}

export interface BuildHandlers {
  compile: HelperHandler;
  cancel: HelperHandler;
  cancelAll(): void;
  /** Stops the project's build and drops the pages sent for it, so its next `pages` carries every page. */
  forget(projectId: string): void;
}

interface ProjectBuilds { deps: ProjectBuildDeps; queue: ProjectBuildQueue; sent: SentPages; token?: BuildToken; typstTail: Promise<void> }

type CompileMessage = Extract<ToHelperMessage, { type: "compile" }>;

const rejectTypst = (): Promise<never> => Promise.reject(new Error("LabShelf Helper builds Typst projects through the language server."));

function createProjectBuilds(options: BuildHandlerOptions, prompt: TexSetupPrompt): ProjectBuilds {
  const deps: ProjectBuildDeps = {
    logger: options.logger, tex: options.tex, prompt,
    projects: { projectBuildDir: (id) => path.join(options.dataDir, "projects", id, "build") },
    typst: { get: rejectTypst },
  };
  return { deps, queue: new ProjectBuildQueue(deps), sent: { hashes: [] }, typstTail: Promise.resolve() };
}

async function reportFailure(options: BuildHandlerOptions, message: CompileMessage, send: HelperSend, error: unknown): Promise<void> {
  await options.logger.error(BUILD_MODULE, error, { projectId: message.projectId, main: message.main });
  const code = error instanceof HelperProjectError ? error.code : "internal";
  send({ v: PROTOCOL_VERSION, id: message.id, type: "error", code, message: error instanceof Error ? error.message : String(error) });
}

// INVARIANT: one Typst export runs per project at a time; a newer build waits for the cancelled one to exit.
function runTypstInBackground(options: BuildHandlerOptions, message: CompileMessage, send: HelperSend, builds: ProjectBuilds, token: BuildToken): void {
  const { dataDir, tinymist, servers, projects, logger } = options;
  builds.typstTail = builds.typstTail
    .then(() => runTypstBuild({ message, send, token, dataDir, tinymist, servers, projects, logger, sent: builds.sent }))
    .catch((error: unknown) => reportFailure(options, message, send, error))
    .finally(() => { if (builds.token === token) { delete builds.token; } });
}

async function runInBackground(options: BuildHandlerOptions, message: CompileMessage, send: HelperSend, builds: ProjectBuilds, token: BuildToken): Promise<void> {
  const { logger } = options;
  try {
    const folder = path.join(options.dataDir, "projects", message.projectId, "src");
    // The page owns the project settings; the engine comes with each build.
    const settings = { id: message.projectId, format: "latex" as const, engine: message.engine };
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

  function buildsOf(projectId: string, prompt: TexSetupPrompt): ProjectBuilds {
    let builds = projects.get(projectId);
    if (!builds) {
      builds = createProjectBuilds(options, prompt);
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
    const builds = buildsOf(message.projectId, helperToolchainPrompt(message.id, send));
    stop(builds);
    const token: BuildToken = { cancelled: false };
    builds.token = token;
    if (message.main.endsWith(".typ")) { runTypstInBackground(options, message, send, builds, token); } else { void runInBackground(options, message, send, builds, token); }
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
