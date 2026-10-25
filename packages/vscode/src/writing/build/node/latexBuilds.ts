// Shows LaTeX build results in the editor: status bar, diagnostics and preview notices around the core build queue.
import * as path from "node:path";
import * as vscode from "vscode";

import type { ProjectBuildResult, ProjectEntry } from "@labshelf/core";
import type { ProjectBuildQueue } from "@labshelf/core/node";
import type { ReadyProject } from "../../buildRootDocument.js";
import type { WritingHost } from "../../session/index.js";
import type { BuildDiagnostics } from "../buildProblems.js";
import type { BuildListener, BuildTrigger, FinishedBuild } from "../buildListener.js";
import { haltOnErrorOn } from "../haltOnError.js";
import { reportToolchainMissing } from "./ensureToolchain.js";

export interface LatexBuildsDeps {
  host: Pick<WritingHost, "current">;
  projects: { list: () => readonly ProjectEntry[] };
  queue: Pick<ProjectBuildQueue, "request" | "cancelAll">;
  diagnostics: Pick<BuildDiagnostics, "publish">;
  previews: BuildListener;
}

const MODULE = "writing/build";

function summary(result: FinishedBuild, main: string): string {
  if (result.status === "succeeded") { return `$(check) Built ${path.basename(result.pdf)}`; }
  const errors = result.problems.filter((problem) => problem.severity === "error").length;
  return `$(error) Build of ${main} failed: ${errors} ${errors === 1 ? "error" : "errors"}`;
}

export class LatexBuilds {
  // Folders whose toolchain prompt the user dismissed; saves stop asking until the Build command runs.
  private readonly declined = new Set<string>();

  constructor(private readonly deps: LatexBuildsDeps) {}

  /**
   * Resolves with the build's result, or `undefined` when it did not finish: cancelled, declined or failed to start.
   * `includeOnly` is the `\include` path to typeset alone; absent builds the whole root.
   */
  async request(projectFolder: string, root: string, trigger: BuildTrigger, includeOnly?: string): Promise<FinishedBuild | undefined> {
    const session = this.deps.host.current();
    const project = this.project(projectFolder);
    if (!session || !project || (trigger === "save" && this.declined.has(projectFolder))) { return undefined; }
    if (!project.main) {
      await vscode.window.showErrorMessage(`Project "${project.settings.id}" has no main file. Choose one from the status bar.`);
      return undefined;
    }
    let spinner: vscode.Disposable | undefined;
    const run = this.deps.queue.request(project, {
      root, haltOnError: haltOnErrorOn(), ...(includeOnly !== undefined && { includeOnly }),
      onCompile: () => {
        spinner = vscode.window.setStatusBarMessage(`$(sync~spin) Building ${root}`);
        this.deps.previews.building(projectFolder, root);
      },
    });
    try {
      const result = await run;
      spinner?.dispose();
      return await this.finish(project, root, trigger, result);
    } catch (error) {
      spinner?.dispose();
      await session.logger.error(MODULE, error, { projectFolder, root, trigger });
      await vscode.window.showErrorMessage(`Build of "${project.settings.id}" failed: ${String(error)}`);
      return undefined;
    }
  }

  cancelAll(): void {
    this.deps.queue.cancelAll();
  }

  private project(projectFolder: string): ReadyProject | undefined {
    const entry = this.deps.projects.list().find((candidate) => candidate.folder === projectFolder);
    return entry?.kind === "ready" ? entry : undefined;
  }

  private async finish(project: ReadyProject, root: string, trigger: BuildTrigger, result: ProjectBuildResult): Promise<FinishedBuild | undefined> {
    if (result.status === "toolchain-missing") {
      this.declined.add(project.folder);
      await reportToolchainMissing(result);
      return undefined;
    }
    if (result.status === "cancelled" || result.status === "no-main") { return undefined; }
    this.declined.delete(project.folder);
    this.deps.diagnostics.publish(path.join(project.folder, root), result.problems);
    this.deps.previews.finished(project, root, result, trigger);
    vscode.window.setStatusBarMessage(summary(result, root), 5000);
    return result;
  }
}
