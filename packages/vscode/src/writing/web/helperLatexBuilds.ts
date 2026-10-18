// Builds LaTeX projects through LabShelf Helper, one build per project at a time, and asks the page for the helper setup when the helper or TeX is missing.
import * as vscode from "vscode";

import { builtPdfPath, errorMessage, listProjectFiles, type ILogger, type LatexEngine } from "@labshelf/core";
import { HELPER_ENGINES, type HelperCompileResult, type HelperEngine, type HelperProjectFile, type ILatexHelper } from "@labshelf/core/helper";
import type { BuildDiagnostics, BuildListener, BuildTrigger, FinishedBuild } from "../build/index.js";
import type { ReadyProject } from "../mainDocument.js";
import type { WritingHost, WritingProjects } from "../session/index.js";

const MODULE = "writing/helperBuild";

export interface HelperLatexBuildsDeps {
  helper: ILatexHelper;
  host: Pick<WritingHost, "current">;
  projects: Pick<WritingProjects, "list" | "fs" | "paths">;
  diagnostics: Pick<BuildDiagnostics, "publish">;
  previews: BuildListener;
  showHelperSetup(): Thenable<unknown>;
}

// The helper runs a TeX distribution, which has no Tectonic; Tectonic runs XeTeX, so XeLaTeX builds what it would.
function helperEngine(engine: LatexEngine | undefined): HelperEngine {
  if (engine === "tectonic") { return "xelatex"; }
  return HELPER_ENGINES.find((candidate) => candidate === engine) ?? "pdflatex";
}

interface ProjectLane {
  running?: Promise<FinishedBuild | undefined> | undefined;
  // INVARIANT: set only while a build runs; a newer request replaces it, so the latest one runs next.
  waiting?: { root: string; trigger: BuildTrigger; settle(result: Promise<FinishedBuild | undefined> | undefined): void } | undefined;
}

export class HelperLatexBuilds {
  private readonly lanes = new Map<string, ProjectLane>();

  constructor(private readonly deps: HelperLatexBuildsDeps) {}

  /**
   * Resolves with the build's result, or `undefined` when it did not finish: helper missing, replaced or failed to run.
   * A request made while the project builds waits; a newer one replaces it, so saves during a build cost one more build.
   */
  request(projectFolder: string, root: string, trigger: BuildTrigger): Promise<FinishedBuild | undefined> {
    const lane = this.lanes.get(projectFolder) ?? {};
    this.lanes.set(projectFolder, lane);
    if (!lane.running) { return this.start(lane, projectFolder, root, trigger); }
    lane.waiting?.settle(undefined);
    return new Promise((resolve) => { lane.waiting = { root, trigger, settle: resolve }; });
  }

  private start(lane: ProjectLane, projectFolder: string, root: string, trigger: BuildTrigger): Promise<FinishedBuild | undefined> {
    const run = this.build(projectFolder, root, trigger);
    lane.running = run;
    void run.catch(() => undefined).then(() => {
      lane.running = undefined;
      const next = lane.waiting;
      lane.waiting = undefined;
      if (next) { next.settle(this.start(lane, projectFolder, next.root, next.trigger)); }
    });
    return run;
  }

  private async build(projectFolder: string, root: string, trigger: BuildTrigger): Promise<FinishedBuild | undefined> {
    const logger = this.deps.host.current()?.logger;
    const project = this.project(projectFolder);
    if (!logger || !project) { return undefined; }
    if (!await this.ready(logger, projectFolder)) { return undefined; }
    const spinner = vscode.window.setStatusBarMessage(`$(sync~spin) Building ${root}`);
    this.deps.previews.building(projectFolder, root);
    try {
      const result = await this.deps.helper.compile(
        { projectId: project.settings.id, main: root, engine: helperEngine(project.settings.engine), files: await this.files(project) },
        () => undefined,
      );
      return await this.finish(project, root, trigger, result, logger);
    } catch (error) {
      await logger.error(MODULE, error, { projectFolder, root, trigger });
      void vscode.window.showErrorMessage(`Build of "${project.settings.id}" failed: ${errorMessage(error)}`);
      return undefined;
    } finally {
      spinner.dispose();
    }
  }

  private project(projectFolder: string): ReadyProject | undefined {
    const entry = this.deps.projects.list().find((candidate) => candidate.folder === projectFolder);
    return entry?.kind === "ready" ? entry : undefined;
  }

  /** Connects to the helper; when it is not ready, or the page has no helper at all, shows the setup card instead. */
  private async ready(logger: ILogger, projectFolder: string): Promise<boolean> {
    let state = "unreachable";
    try {
      state = (await this.deps.helper.connect()).state;
    } catch (error) {
      await logger.error(MODULE, error, { projectFolder, action: "connect to LabShelf Helper" });
    }
    if (state === "ready") { return true; }
    await logger.log("INFO", MODULE, "LabShelf Helper is not ready; showing its setup", { projectFolder, state });
    await this.showSetup(logger);
    return false;
  }

  private async showSetup(logger: ILogger): Promise<void> {
    try {
      await this.deps.showHelperSetup();
    } catch (error) {
      await logger.error(MODULE, error, { action: "show the helper setup" });
      void vscode.window.showErrorMessage("Building LaTeX here needs LabShelf Helper, and this page cannot set it up.");
    }
  }

  private async files(project: ReadyProject): Promise<HelperProjectFile[]> {
    const { fs, paths } = this.deps.projects;
    const relatives = await listProjectFiles(this.deps.projects, project.folder);
    return await Promise.all(relatives.map(async (path) => ({ path, bytes: await fs.readFile(paths.join(project.folder, path)) })));
  }

  private async finish(
    project: ReadyProject, root: string, trigger: BuildTrigger, result: HelperCompileResult, logger: ILogger,
  ): Promise<FinishedBuild | undefined> {
    if (result.status === "toolchain-missing") { await this.showSetup(logger); return undefined; }
    if (result.status === "needs-shell-escape") {
      void vscode.window.showErrorMessage(`${project.settings.id} needs shell escape, which LabShelf Helper does not run.`);
      return undefined;
    }
    if (result.status === "cancelled") { return undefined; }
    const { paths } = this.deps.projects;
    let finished: FinishedBuild = { status: "failed", problems: result.problems };
    if (result.status === "succeeded") {
      // INVARIANT: root is non-empty, so the PDF path exists.
      const pdf = builtPdfPath(paths, project, root)!;
      // PLATFORM: the editor page's project store can neither rename nor delete, so the library file system's staged
      // write (temp file, then rename over the target) fails there; the store writes each file whole in one call.
      await vscode.workspace.fs.writeFile(vscode.Uri.file(pdf), result.pdf);
      finished = { status: "succeeded", pdf, problems: result.problems };
    }
    this.deps.diagnostics.publish(paths.join(project.folder, root), result.problems);
    this.deps.previews.finished(project, root, finished, trigger);
    return finished;
  }
}
