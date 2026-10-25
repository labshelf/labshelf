// Assembles what a build run needs from the terminal: the build queue with its dependencies, the source watcher and Ctrl-C.
import * as os from "node:os";
import * as path from "node:path";

import { createProjectData } from "@labshelf/core";
import { createSharedTexProvider, deviceLocalLayout, NodeLibraryFileSystem, ProjectBuildQueue } from "@labshelf/core/node";

import type { AppContext } from "../../compositionRoot.js";
import type { ReadyProject } from "./findProject.js";
import { terminalTexSetupPrompt, type Ask } from "./askToolchain.js";
import { watchSources } from "./watchSources.js";
import { withPrompt } from "../ask.js";

export type BuildContext = Pick<AppContext, "logger" | "paths">;

export interface BuildEnvironment {
  queue: Pick<ProjectBuildQueue, "cancelAll"> & { request(project: ReadyProject): ReturnType<ProjectBuildQueue["request"]> };
  /** @returns a function that stops watching */
  watchSources(folder: string, onChange: () => void): () => void;
  /** Resolves on Ctrl-C; called only by `--watch`, so a one-shot build keeps the default Ctrl-C. */
  interrupted(): Promise<void>;
}

/** The terminal's answer channel: absent when stdin or stderr is not a terminal, so questions are declined. */
export function processAsk(): Ask | undefined {
  return process.stdin.isTTY && process.stderr.isTTY ? (question) => withPrompt((ask) => ask(question)) : undefined;
}

const rejectTypst = (): Promise<never> => Promise.reject(new Error("Typst projects cannot be built from the terminal yet."));

export function terminalBuildEnvironment(ctx: BuildContext, tty: { ask: Ask | undefined }): BuildEnvironment {
  const data = createProjectData({
    fs: new NodeLibraryFileSystem(), path, logger: ctx.logger, deviceDirs: deviceLocalLayout(ctx.paths.root),
  });
  return {
    queue: new ProjectBuildQueue({
      logger: ctx.logger,
      prompt: terminalTexSetupPrompt(tty.ask),
      tex: createSharedTexProvider({ env: process.env, platform: process.platform, homeDir: os.homedir(), logger: ctx.logger, fetchImpl: fetch }),
      projects: data,
      typst: { get: rejectTypst },
    }),
    watchSources,
    interrupted: () => new Promise((resolve) => { process.once("SIGINT", () => resolve()); }),
  };
}
