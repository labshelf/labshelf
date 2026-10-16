// Runs LaTeX builds one at a time per project: a newer request cancels the running compile and queues one fresh build.
import * as path from "node:path";
import * as vscode from "vscode";

import { projectBuildDir, runLatexBuild, type LatexBuildResult, type ProjectEntry } from "@labshelf/core/node";
import type { TypstBuildResult } from "@labshelf/core/typst/node";
import type { ReadyProject } from "../mainDocument.js";
import type { BuildDiagnostics } from "./buildDiagnostics.js";
import { ensureToolchain, type ToolchainDeps } from "./toolchain/index.js";

export type BuildTrigger = "command" | "save";

/** A Typst build's success also carries where it placed each citation. */
export type FinishedBuild = Exclude<LatexBuildResult, { status: "cancelled" }> | TypstBuildResult;

/** Told when a project's compile starts and when it ends; a cancelled compile never ends, the next one replaces it. */
export interface BuildListener {
  building(projectFolder: string): void;
  finished(project: ReadyProject, result: FinishedBuild, trigger: BuildTrigger): void;
}

export interface LatexBuildsDeps extends ToolchainDeps {
  projects: ToolchainDeps["projects"] & { list: () => readonly ProjectEntry[] };
  diagnostics: Pick<BuildDiagnostics, "publish">;
  previews: BuildListener;
}

interface ProjectBuilds {
  chain: Promise<void>;
  queued: boolean;
  running?: AbortController | undefined;
}

const MODULE = "writing/build";

function summary(result: FinishedBuild, main: string): string {
  if (result.status === "succeeded") { return `$(check) Built ${path.basename(result.pdf)}`; }
  const errors = result.problems.filter((problem) => problem.severity === "error").length;
  return `$(error) Build of ${main} failed: ${errors} ${errors === 1 ? "error" : "errors"}`;
}

export class LatexBuilds {
  private readonly builds = new Map<string, ProjectBuilds>();
  // Folders whose toolchain prompt the user dismissed; saves stop asking until the Build command runs.
  private readonly declined = new Set<string>();

  constructor(private readonly deps: LatexBuildsDeps) {}

  request(projectFolder: string, trigger: BuildTrigger): Promise<void> {
    const state = this.builds.get(projectFolder) ?? { chain: Promise.resolve(), queued: false };
    this.builds.set(projectFolder, state);
    state.running?.abort();
    if (state.queued) { return state.chain; }
    state.queued = true;
    state.chain = state.chain.then(async () => {
      state.queued = false;
      await this.run(projectFolder, trigger, state);
    });
    return state.chain;
  }

  cancelAll(): void {
    for (const state of this.builds.values()) { state.running?.abort(); }
  }

  private project(projectFolder: string): ReadyProject | undefined {
    const entry = this.deps.projects.list().find((candidate) => candidate.folder === projectFolder);
    return entry?.kind === "ready" ? entry : undefined;
  }

  private async run(projectFolder: string, trigger: BuildTrigger, state: ProjectBuilds): Promise<void> {
    const session = this.deps.host.current();
    const project = this.project(projectFolder);
    if (!session || !project || (trigger === "save" && this.declined.has(projectFolder))) { return; }
    if (!project.main) {
      await vscode.window.showErrorMessage(`Project "${project.settings.id}" has no main file. Choose one from the status bar.`);
      return;
    }
    try {
      const toolchain = await ensureToolchain(this.deps, project);
      if (!toolchain) {
        this.declined.add(projectFolder);
        return;
      }
      this.declined.delete(projectFolder);
      const controller = new AbortController();
      state.running = controller;
      const building = vscode.window.setStatusBarMessage(`$(sync~spin) Building ${project.main}`);
      this.deps.previews.building(projectFolder);
      const result = await runLatexBuild({
        toolchain, projectFolder, main: project.main, outDir: projectBuildDir(project.settings.id),
        signal: controller.signal, logger: session.logger,
      }).finally(() => building.dispose());
      if (state.running === controller) { state.running = undefined; }
      if (result.status === "cancelled") { return; }
      this.deps.diagnostics.publish(projectFolder, result.problems);
      this.deps.previews.finished(project, result, trigger);
      vscode.window.setStatusBarMessage(summary(result, project.main), 5000);
    } catch (error) {
      await session.logger.error(MODULE, error, { projectFolder, trigger });
      await vscode.window.showErrorMessage(`Build of "${project.settings.id}" failed: ${String(error)}`);
    }
  }
}
