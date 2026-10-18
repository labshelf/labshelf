// Creates the `build` and `cancel` handlers: one build queue per project, and a token per build that a cancel or a newer build trips.
import * as path from "node:path";

import type { ILogger } from "@labshelf/core";
import { ProjectBuildQueue, type ProjectBuildDeps } from "@labshelf/core/node";
import { PROTOCOL_VERSION, type ToHelperMessage } from "@labshelf/core/helper";

import type { HelperHandler, HelperSend } from "../dispatch/index.js";
import { BUILD_MODULE, runBuildJob, type BuildToken } from "./runBuildJob.js";
import { helperToolchainPrompt, type TexProvider } from "./toolchain/index.js";

export interface BuildHandlerOptions {
  projectsRoot: string;
  /** The mirrored source folder of a project. */
  sourceDir(projectId: string): string;
  tex: TexProvider;
  logger: ILogger;
}

interface ProjectBuilds { deps: ProjectBuildDeps; queue: ProjectBuildQueue; token?: BuildToken }

type BuildMessage = Extract<ToHelperMessage, { type: "build" }>;

const rejectTypst = (): Promise<never> => Promise.reject(new Error("LabShelf Helper builds only LaTeX projects."));

function createProjectBuilds(projectsRoot: string, projectId: string, logger: ILogger): ProjectBuilds {
  const buildDir = (id: string): string => path.join(projectsRoot, id, "build");
  const deps: ProjectBuildDeps = {
    logger, toolchain: helperToolchainPrompt("pdflatex"),
    // Tectonic is never offered, so nothing is stored here.
    storageDir: buildDir(projectId),
    // The page owns the project settings; the engine comes with each build.
    projects: { updateProjectSettings: () => Promise.resolve(), projectBuildDir: buildDir },
    typst: { get: rejectTypst },
  };
  return { deps, queue: new ProjectBuildQueue(deps) };
}

async function runInBackground(options: BuildHandlerOptions, message: BuildMessage, send: HelperSend, builds: ProjectBuilds, token: BuildToken): Promise<void> {
  const { logger } = options;
  try {
    const folder = options.sourceDir(message.projectId);
    const project = { kind: "ready" as const, folder, location: "external" as const, settings: { id: message.projectId, format: "latex" as const }, main: message.main };
    await runBuildJob({ message, send, token, queue: builds.queue, project, tex: options.tex, logger });
  } catch (error) {
    await logger.error(BUILD_MODULE, error, { projectId: message.projectId, main: message.main });
    send({ v: PROTOCOL_VERSION, id: message.id, type: "error", code: "internal", message: error instanceof Error ? error.message : String(error) });
  } finally {
    if (builds.token === token) { delete builds.token; }
  }
}

export function createBuildHandlers(options: BuildHandlerOptions): { build: HelperHandler; cancel: HelperHandler } {
  const { projectsRoot, logger } = options;
  const projects = new Map<string, ProjectBuilds>();

  function buildsOf(projectId: string): ProjectBuilds {
    let builds = projects.get(projectId);
    if (!builds) {
      builds = createProjectBuilds(projectsRoot, projectId, logger);
      projects.set(projectId, builds);
    }
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
    const builds = buildsOf(message.projectId);
    stop(builds);
    const token: BuildToken = { cancelled: false };
    builds.token = token;
    // INVARIANT: the queue runs only its latest request, which is this one, so the prompt it reads carries this engine.
    builds.deps.toolchain = helperToolchainPrompt(message.engine);
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
