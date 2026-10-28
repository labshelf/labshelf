// Prepares the LaTeX toolchain for callers outside the build queue, tells the user why none is ready, and assembles the core build deps, session logger and shared TeX.
import * as os from "node:os";
import * as vscode from "vscode";

import { deriveTexLiveGuideUrl, type ILogger, type LatexToolchain, type ToolchainMissing } from "@labshelf/core";
import { createSharedTexProvider, ensureToolchain as ensureCoreToolchain, type ProjectBuildDeps, type ToolchainDeps as CoreToolchainDeps } from "@labshelf/core/node";
import { runSafely } from "../../../command/index.js";
import type { ReadyProject } from "../../projects/index.js";
import type { WritingHost, WritingProjects } from "../../projects/index.js";
import { createVscodeToolchainAsk } from "../toolchain.js";

const OPEN_GUIDE = "Open install guide";

export interface ToolchainDeps {
  /** The per-user TeX every LabShelf app shares. */
  tex: CoreToolchainDeps["tex"];
  host: Pick<WritingHost, "current">;
}

/** Explains a toolchain that could not be prepared; a declined prompt needs no message because the user chose it. */
export async function reportToolchainMissing(missing: ToolchainMissing): Promise<void> {
  if (missing.reason !== "install-failed") { return; }
  const choice = await vscode.window.showErrorMessage(`LaTeX could not be installed: ${missing.message}`, OPEN_GUIDE);
  if (choice === OPEN_GUIDE) { await vscode.env.openExternal(vscode.Uri.parse(deriveTexLiveGuideUrl(process.platform))); }
}

/** The program that builds the project, asking the user on the first build; undefined when nothing is ready to run. */
export async function ensureToolchain(deps: ToolchainDeps, project: ReadyProject): Promise<LatexToolchain | undefined> {
  const session = deps.host.current();
  if (!session) { return undefined; }
  let toolchain: LatexToolchain | undefined;
  await runSafely(session.logger, "labshelf.writing.ensureToolchain", async () => {
    const result = await ensureCoreToolchain(project, {
      logger: session.logger,
      prompt: createVscodeToolchainAsk(),
      tex: deps.tex,
    });
    if ("executable" in result) { toolchain = result; } else { await reportToolchainMissing(result); }
  });
  return toolchain;
}

/** Long-lived objects keep one logger while the open library, and so its log file, can change. */
export function createSessionLogger(host: Pick<WritingHost, "current">): ILogger {
  return {
    log: async (...args) => { await host.current()?.logger.log(...args); },
    error: async (...args) => { await host.current()?.logger.error(...args); },
  };
}

export interface ProjectBuildDepsSource {
  host: Pick<WritingHost, "current">;
  projects: Pick<WritingProjects, "data" | "fs">;
  tex: ProjectBuildDeps["tex"];
  typst: ProjectBuildDeps["typst"];
}

export function createProjectBuildDeps(source: ProjectBuildDepsSource): ProjectBuildDeps {
  return {
    logger: createSessionLogger(source.host),
    projectWriter: source.projects.fs,
    prompt: createVscodeToolchainAsk(),
    tex: source.tex,
    projects: { projectBuildDir: (id) => source.projects.data.projectBuildDir(id) },
    typst: source.typst,
  };
}

export function createVscodeTex(host: Pick<WritingHost, "current">): ReturnType<typeof createSharedTexProvider> {
  return createSharedTexProvider({
    env: process.env, platform: process.platform, homeDir: os.homedir(), logger: createSessionLogger(host), fetchImpl: fetch,
  });
}
