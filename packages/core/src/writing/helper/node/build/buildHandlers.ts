// Creates the `build` and `cancel` handlers: one build queue per project, and a token per build that a cancel or a newer build trips.
import * as path from "node:path";

import type { ILogger } from "../../../../ports/index.js";
import { ProjectBuildQueue, type ProjectBuildDeps } from "../../../build/node/index.js";
import type { TexSetupPrompt } from "../../../build/index.js";
import type { ManagedTexProvider } from "../../../latex/toolchain/node/managed/index.js";
import { PROTOCOL_VERSION, type ToHelperMessage } from "../../index.js";

import type { HelperHandler, HelperSend } from "../dispatch/index.js";
import { BUILD_MODULE, runBuildJob, type BuildToken } from "./runBuildJob.js";
import { helperToolchainPrompt } from "./helperToolchainPrompt.js";

export interface BuildHandlerOptions {
  projectsRoot: string;
  /** The mirrored source folder of a project. */
  sourceDir(projectId: string): string;
  tex: ManagedTexProvider;
  logger: ILogger;
}

interface ProjectBuilds { deps: ProjectBuildDeps; queue: ProjectBuildQueue; token?: BuildToken }

type BuildMessage = Extract<ToHelperMessage, { type: "build" }>;

const rejectTypst = (): Promise<never> => Promise.reject(new Error("LabShelf Helper builds only LaTeX projects."));

function createProjectBuilds(options: BuildHandlerOptions, prompt: TexSetupPrompt): ProjectBuilds {
  const deps: ProjectBuildDeps = {
    logger: options.logger, tex: options.tex, prompt,
    projects: { projectBuildDir: (id) => path.join(options.projectsRoot, id, "build") },
    typst: { get: rejectTypst },
  };
  return { deps, queue: new ProjectBuildQueue(deps) };
}

async function runInBackground(options: BuildHandlerOptions, message: BuildMessage, send: HelperSend, builds: ProjectBuilds, token: BuildToken): Promise<void> {
  const { logger } = options;
  try {
    const folder = options.sourceDir(message.projectId);
    // The page owns the project settings; the engine comes with each build.
    const settings = { id: message.projectId, format: "latex" as const, engine: message.engine };
    const project = { kind: "ready" as const, folder, location: "external" as const, settings, main: message.main };
    await runBuildJob({ message, send, token, queue: builds.queue, project, logger });
  } catch (error) {
    await logger.error(BUILD_MODULE, error, { projectId: message.projectId, main: message.main });
    send({ v: PROTOCOL_VERSION, id: message.id, type: "error", code: "internal", message: error instanceof Error ? error.message : String(error) });
  } finally {
    if (builds.token === token) { delete builds.token; }
  }
}

export function createBuildHandlers(options: BuildHandlerOptions): { build: HelperHandler; cancel: HelperHandler } {
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
  const build: HelperHandler = (message, send) => {
    if (message.type !== "build") { throw new Error(`build handler received ${message.type}`); }
    const builds = buildsOf(message.projectId, helperToolchainPrompt(message.id, send));
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

  return { build, cancel };
}
