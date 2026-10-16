// Runs LaTeX builds one at a time per project: a newer request for any root cancels the running compile and queues one fresh build.
import * as path from "node:path";
import * as vscode from "vscode";

import { rootBuildFolder, type ILogger, type ProjectEntry } from "@labshelf/core";
import { clearFlatBuildFiles, projectBuildDir, runLatexBuild, updateProjectValues } from "@labshelf/core/node";
import type { ReadyProject } from "../../mainDocument.js";
import type { BuildDiagnostics } from "../buildDiagnostics.js";
import type { BuildListener, BuildTrigger, FinishedBuild } from "../buildListener.js";
import type { ToolchainDeps } from "../toolchain/index.js";
import { ensureToolchain } from "../toolchain/node/index.js";

export interface LatexBuildsDeps extends ToolchainDeps {
  projects: ToolchainDeps["projects"] & { list: () => readonly ProjectEntry[] };
  diagnostics: Pick<BuildDiagnostics, "publish">;
  previews: BuildListener;
}

interface ProjectBuilds {
  chain: Promise<FinishedBuild | undefined>;
  // INVARIANT: set while a build waits in the chain; a later request overwrites it, so the latest root and trigger run.
  queued?: { root: string; trigger: BuildTrigger } | undefined;
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

  /** Resolves with the build's result, or `undefined` when it did not finish: cancelled, declined or failed to start. */
  request(projectFolder: string, root: string, trigger: BuildTrigger): Promise<FinishedBuild | undefined> {
    const state: ProjectBuilds = this.builds.get(projectFolder) ?? { chain: Promise.resolve(undefined) };
    this.builds.set(projectFolder, state);
    state.running?.abort();
    const waiting = state.queued !== undefined;
    state.queued = { root, trigger };
    if (waiting) { return state.chain; }
    state.chain = state.chain.then(async () => {
      const next = state.queued!;
      state.queued = undefined;
      return this.run(projectFolder, next.root, next.trigger, state);
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

  // A failure leaves the macro undefined, which LaTeX reports itself, so the build still runs.
  private async generateValues(project: ReadyProject, logger: ILogger): Promise<void> {
    if (!project.settings.values?.length) { return; }
    try {
      await updateProjectValues(project, logger);
    } catch (error) {
      await logger.error(MODULE, error, { projectFolder: project.folder, action: "generate-values" });
    }
  }

  private async run(projectFolder: string, root: string, trigger: BuildTrigger, state: ProjectBuilds): Promise<FinishedBuild | undefined> {
    const session = this.deps.host.current();
    const project = this.project(projectFolder);
    if (!session || !project || (trigger === "save" && this.declined.has(projectFolder))) { return undefined; }
    if (!project.main) {
      await vscode.window.showErrorMessage(`Project "${project.settings.id}" has no main file. Choose one from the status bar.`);
      return undefined;
    }
    try {
      const toolchain = await ensureToolchain(this.deps, project);
      if (!toolchain) {
        this.declined.add(projectFolder);
        return undefined;
      }
      this.declined.delete(projectFolder);
      const controller = new AbortController();
      state.running = controller;
      const building = vscode.window.setStatusBarMessage(`$(sync~spin) Building ${root}`);
      this.deps.previews.building(projectFolder, root);
      await this.generateValues(project, session.logger);
      const buildDir = projectBuildDir(project.settings.id);
      await clearFlatBuildFiles(buildDir, root, session.logger);
      const result = await runLatexBuild({
        toolchain, projectFolder, main: root, outDir: path.join(buildDir, rootBuildFolder(root)),
        signal: controller.signal, logger: session.logger,
      }).finally(() => building.dispose());
      if (state.running === controller) { state.running = undefined; }
      if (result.status === "cancelled") { return undefined; }
      this.deps.diagnostics.publish(path.join(projectFolder, root), result.problems);
      this.deps.previews.finished(project, root, result, trigger);
      vscode.window.setStatusBarMessage(summary(result, root), 5000);
      return result;
    } catch (error) {
      await session.logger.error(MODULE, error, { projectFolder, root, trigger });
      await vscode.window.showErrorMessage(`Build of "${project.settings.id}" failed: ${String(error)}`);
      return undefined;
    }
  }
}
