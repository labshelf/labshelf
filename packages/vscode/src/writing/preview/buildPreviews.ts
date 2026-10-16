// Keeps one reader preview per writing project: reloads it after a build, shows the build status and opens it when asked.
import * as vscode from "vscode";

import type { BuildState, PaperRecord, PathOps, ProjectDataPort, TypstCite, LocatedProblem } from "@labshelf/core";
import { ReaderPanel, type ReaderPanelDeps } from "../../pdf-viewer/index.js";
import type { BuildListener, BuildTrigger, FinishedBuild } from "../build/index.js";
import type { ReadyProject } from "../mainDocument.js";
import type { WritingHost } from "../projectStore.js";
import { createPreviewPorts } from "./previewPorts.js";
import { PREVIEW_LOG_MODULE } from "./previewStrings.js";
import { createPreviewStore } from "./previewStore.js";
import { ProjectSynctex, revealInPreview } from "./sourceLinks/index.js";

export interface BuildPreviewsDeps extends Pick<ReaderPanelDeps, "extensionUri" | "locatePdfjs" | "isMac"> {
  host: Pick<WritingHost, "current">;
  listPapers: () => Promise<PaperRecord[]>;
  paths: PathOps;
  data: ProjectDataPort;
}

function previewPaper(paths: PathOps, project: ReadyProject, pdf: string): PaperRecord {
  return { id: `preview:${project.settings.id}`, title: paths.basename(pdf), path: paths.dirname(pdf), citeKey: "", status: "reading" };
}

export class BuildPreviews implements BuildListener {
  private readonly panels = new Map<string, ReaderPanel>();
  private readonly problems = new Map<string, readonly LocatedProblem[]>();
  // INVARIANT: the cites of the last successful Typst build, i.e. of the PDF a preview shows; a failed build leaves them.
  private readonly typstCites = new Map<string, readonly TypstCite[]>();
  // A preview opened during a build or after a failed one shows that state at once.
  private readonly states = new Map<string, { state: BuildState; errors: number }>();

  private readonly synctex: ProjectSynctex;

  constructor(private readonly deps: BuildPreviewsDeps) {
    this.synctex = new ProjectSynctex(deps.host, deps.paths, deps.data);
  }

  /** Tells an open preview that a build of the project started. */
  building(projectFolder: string): void {
    this.states.set(projectFolder, { state: "building", errors: 0 });
    this.panels.get(projectFolder)?.controller.setBuildStatus("building");
  }

  /** Reloads an open preview after a build, or opens one when the build was asked for with the command. */
  finished(project: ReadyProject, result: FinishedBuild, trigger: BuildTrigger): void {
    this.problems.set(project.folder, result.problems);
    const panel = this.panels.get(project.folder);
    if (result.status === "failed") {
      const errors = result.problems.filter((problem) => problem.severity === "error").length;
      this.states.set(project.folder, { state: "failed", errors });
      panel?.controller.setBuildStatus("failed", errors);
      return;
    }
    this.states.delete(project.folder);
    if ("cites" in result) { this.typstCites.set(project.folder, result.cites); }
    // INVARIANT: an open preview holds the SyncTeX data of the build it shows, read before a later failed build can overwrite the file.
    this.synctex.invalidate(project.folder);
    if (panel) {
      if (project.settings.format === "latex") { void this.synctex.load(project); }
      panel.controller.reloadDocument();
      panel.controller.setBuildStatus("succeeded");
      void this.deps.host.current()?.logger.log("INFO", PREVIEW_LOG_MODULE, "Reloaded preview", { projectFolder: project.folder, pdf: result.pdf });
    } else if (trigger === "command") {
      this.show(project, result.pdf, { beside: true });
    }
  }

  hasPreview(projectFolder: string): boolean {
    return this.panels.has(projectFolder);
  }

  /** Opens the project's preview on a PDF, or reveals the open one. */
  show(project: ReadyProject, pdf: string, options: { beside: boolean }): void {
    const session = this.deps.host.current();
    if (!session) { return; }
    try {
      const panel = ReaderPanel.createOrShow({ ...this.deps, logger: session.logger }, {
        key: `preview:${project.folder}`,
        paper: previewPaper(this.deps.paths, project, pdf),
        store: createPreviewStore(),
        pdfUri: vscode.Uri.file(pdf),
        rootDir: vscode.Uri.file(this.deps.paths.dirname(pdf)),
        preview: createPreviewPorts({
          logger: session.logger, paths: this.deps.paths, projectFolder: project.folder, problems: () => this.problems.get(project.folder) ?? [],
          synctex: () => this.synctex.load(project),
          format: project.settings.format, listPapers: this.deps.listPapers,
          typstCites: () => this.typstCites.get(project.folder) ?? [],
        }),
        onClosed: () => { this.panels.delete(project.folder); },
        ...(options.beside ? { show: { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true } } : {}),
      });
      this.panels.set(project.folder, panel);
      const last = this.states.get(project.folder);
      if (last) { panel.controller.setBuildStatus(last.state, last.errors); }
      void session.logger.log("INFO", PREVIEW_LOG_MODULE, "Opened preview", { projectFolder: project.folder, pdf });
    } catch (error) {
      void session.logger.error(PREVIEW_LOG_MODULE, error, { projectFolder: project.folder, pdf });
    }
  }

  /** Scrolls the project's open preview to the output of a source line (1-based) and marks it. */
  async revealSource(project: ReadyProject, file: string, line: number): Promise<void> {
    const session = this.deps.host.current();
    const panel = this.panels.get(project.folder);
    if (!session || !panel) { return; }
    await revealInPreview({
      logger: session.logger, projectFolder: project.folder, synctex: () => this.synctex.load(project),
      reveal: (point) => panel.controller.revealPoint(point),
    }, file, line);
  }
}
