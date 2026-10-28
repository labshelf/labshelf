// Registers the Node-side build commands: the LaTeX builds (the core build queue behind the Build command and the build after each save) and Check Before Submitting (builds the project, checks its PDF and sources, and lists the findings in Problems).
import * as path from "node:path";
import * as vscode from "vscode";

import type { CheckProblem, FinishedBuild, ILogger, PdfjsLoader, ProjectBuildResult, ProjectEntry } from "@labshelf/core";
import { ProjectBuildQueue, checkProject, type ProjectBuildDeps } from "@labshelf/core/node";
import { runSafely } from "../../../command/index.js";
import { readBuiltPdf, type BuildPreviews } from "../../preview/index.js";
import { CHECK_COMMAND, type ReadyProject, type WritingHost, type WritingProjects } from "../../projects/index.js";
import { registerLatexTypingWrites, registerLatexWriteBuilds } from "../autoBuild.js";
import { deriveCheckProblems } from "../check.js";
import { ProjectProblems, readActiveProject, shouldHaltOnError, type BuildListener, type BuildProblems, type BuildTrigger, type ProjectBuilders } from "../builds.js";
import type { FindIncludeOnly } from "../includeOnly.js";
import { createProjectBuildDeps, reportToolchainMissing } from "./toolchain.js";

interface LatexBuildsDeps {
  host: Pick<WritingHost, "current">;
  projects: { list: () => readonly ProjectEntry[] };
  queue: Pick<ProjectBuildQueue, "request" | "cancelAll">;
  diagnostics: Pick<BuildProblems, "publish">;
  previews: BuildListener;
}

const MODULE = "writing/build";

function buildSummary(result: FinishedBuild, main: string): string {
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
      root, haltOnError: shouldHaltOnError(), ...(includeOnly !== undefined && { includeOnly }),
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
    vscode.window.setStatusBarMessage(buildSummary(result, root), 5000);
    return result;
  }
}

interface LatexBuildDeps {
  context: vscode.ExtensionContext;
  host: WritingHost;
  tex: ProjectBuildDeps["tex"];
  projects: Pick<WritingProjects, "data" | "list" | "paths" | "fs" | "reload">;
  previews: Pick<BuildPreviews, "building" | "finished">;
  diagnostics: Pick<BuildProblems, "publish">;
  /** The `\include` path a save builds alone while the preview's include-only toggle is on. */
  includeOnlyTarget?: FindIncludeOnly;
}

/** Registers the save builds and returns the builds, which the Build Project command also uses. */
export function registerLatexBuild(deps: LatexBuildDeps): LatexBuilds {
  const queue = new ProjectBuildQueue(createProjectBuildDeps({
    host: deps.host, projects: deps.projects, tex: deps.tex,
    // INVARIANT: this queue only builds LaTeX projects (the save builds pick LaTeX projects), so the Typst compiler is never requested.
    typst: { get: () => Promise.reject(new Error("The LaTeX build queue does not compile Typst projects.")) },
  }));
  const builds = new LatexBuilds({ host: deps.host, projects: deps.projects, queue, diagnostics: deps.diagnostics, previews: deps.previews });
  registerLatexWriteBuilds({
    context: deps.context, host: deps.host, projects: deps.projects,
    request: (folder, root, includeOnly) => builds.request(folder, root, "save", includeOnly),
    ...(deps.includeOnlyTarget && { includeOnlyTarget: deps.includeOnlyTarget }),
  });
  registerLatexTypingWrites({ context: deps.context, host: deps.host, projects: deps.projects });
  deps.context.subscriptions.push({ dispose: () => builds.cancelAll() });
  return builds;
}

interface CheckCommandDeps {
  context: vscode.ExtensionContext;
  host: WritingHost;
  projects: Pick<WritingProjects, "data" | "list" | "paths" | "fs">;
  builders: ProjectBuilders;
  pdfjs: PdfjsLoader;
  /** Called with a project's finding count after each completed check. */
  onFindings?(folder: string, count: number): void;
}

function findingsSummary(count: number): string {
  return `${count} ${count === 1 ? "problem" : "problems"} found before submitting.`;
}

function runCheck(deps: CheckCommandDeps, project: ReadyProject, pdfPath: string, logger: ILogger): Thenable<CheckProblem[]> {
  const options = { location: vscode.ProgressLocation.Notification, title: `Checking "${project.settings.id}" before submitting` };
  return vscode.window.withProgress(options, () =>
    checkProject({ folder: project.folder, pdfPath, settings: project.settings.check }, deps.pdfjs, logger));
}

async function checkBeforeSubmitting(deps: CheckCommandDeps, diagnostics: ProjectProblems, entry: ProjectEntry | undefined): Promise<void> {
  const session = deps.host.current();
  if (!session) { return; }
  await runSafely(session.logger, CHECK_COMMAND, async () => {
    const project = entry?.kind === "ready" ? entry : readActiveProject(deps.projects);
    if (!project) {
      await vscode.window.showInformationMessage("Open a file of a writing project to check it.");
      return;
    }
    // The check reads the PDF of the sources as they are now, so it builds first.
    await vscode.workspace.saveAll(false);
    const build = await deps.builders[project.settings.format].request(project.folder, project.main ?? "", "command");
    if (build?.status !== "succeeded") {
      await vscode.window.showWarningMessage("The check needs a successful build. The build problems are listed in Problems.");
      return;
    }
    const pdfPath = await readBuiltPdf(deps.projects, project, project.main);
    if (!pdfPath) {
      await vscode.window.showInformationMessage("Build the project first; the check reads its PDF.");
      return;
    }
    const findings = await runCheck(deps, project, pdfPath, session.logger);
    diagnostics.replace(project.folder, deriveCheckProblems(findings, pdfPath));
    deps.onFindings?.(project.folder, findings.length);
    if (findings.length === 0) {
      void vscode.window.showInformationMessage("No problems found before submitting.");
      return;
    }
    await vscode.commands.executeCommand("workbench.actions.view.problems");
    void vscode.window.showInformationMessage(findingsSummary(findings.length));
  });
}

export function registerCheckCommand(deps: CheckCommandDeps): void {
  const diagnostics = new ProjectProblems("labshelf-check");
  deps.context.subscriptions.push(
    diagnostics,
    vscode.commands.registerCommand(CHECK_COMMAND, (entry?: ProjectEntry) => checkBeforeSubmitting(deps, diagnostics, entry)),
  );
}
