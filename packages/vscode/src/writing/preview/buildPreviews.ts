// Keeps one reader preview per writing project: reloads it after a build, shows the build status and opens it when asked.
import * as vscode from "vscode";

import type { BuildState, PaperRecord, PathOps, ProjectDataPort, TypstCite, LocatedProblem } from "@labshelf/core";
import { ReaderPanel, type ReaderPanelDeps } from "../../pdf-viewer/index.js";
import type { BuildListener, BuildTrigger, FinishedBuild } from "../build/index.js";
import type { ReadyProject } from "../mainDocument.js";
import type { WritingHost } from "../session/index.js";
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
  // Build state is keyed by the absolute path of the compiled root, so one root's build never overwrites another's.
  private readonly problems = new Map<string, readonly LocatedProblem[]>();
  // INVARIANT: the cites of a root's last successful Typst build, i.e. of the PDF a preview shows; a failed build leaves them.
  private readonly typstCites = new Map<string, readonly TypstCite[]>();
  // A preview opened during a build or after a failed one shows that state at once.
  private readonly states = new Map<string, { state: BuildState; errors: number }>();
  // The root (relative to the project folder) whose PDF each project's open preview shows; its banner and reloads follow only that root.
  private readonly shown = new Map<string, string>();

  private readonly synctex: ProjectSynctex;

  constructor(private readonly deps: BuildPreviewsDeps) {
    this.synctex = new ProjectSynctex(deps.host, deps.paths, deps.data);
  }

  /** Tells an open preview that a build of the root it shows started. */
  building(projectFolder: string, root: string): void {
    const key = this.deps.paths.join(projectFolder, root);
    this.states.set(key, { state: "building", errors: 0 });
    if (this.shownRoot(projectFolder) === root) { this.panels.get(projectFolder)?.controller.setBuildStatus("building"); }
  }

  /** Reloads an open preview after a build of the root it shows, or opens one when the build was asked for with the command. */
  finished(project: ReadyProject, root: string, result: FinishedBuild, trigger: BuildTrigger): void {
    const key = this.deps.paths.join(project.folder, root);
    this.problems.set(key, result.problems);
    const shown = this.shownRoot(project.folder);
    const panel = shown === root ? this.panels.get(project.folder) : undefined;
    if (result.status === "failed") {
      const errors = result.problems.filter((problem) => problem.severity === "error").length;
      this.states.set(key, { state: "failed", errors });
      panel?.controller.setBuildStatus("failed", errors);
      return;
    }
    this.states.delete(key);
    if ("cites" in result) { this.typstCites.set(key, result.cites); }
    if (trigger === "focus" && shown !== undefined && shown !== root) {
      this.show(project, root, result.pdf, { beside: true });
      return;
    }
    if (shown !== undefined && shown !== root) { return; }
    // INVARIANT: an open preview holds the SyncTeX data of the build it shows, read before a later failed build can overwrite the file.
    this.synctex.invalidate(project.folder);
    if (panel) {
      if (project.settings.format === "latex") { void this.synctex.load(project, root); }
      panel.controller.reloadDocument();
      panel.controller.setBuildStatus("succeeded");
      void this.deps.host.current()?.logger.log("INFO", PREVIEW_LOG_MODULE, "Reloaded preview", { projectFolder: project.folder, root, pdf: result.pdf });
    } else if (trigger === "command") {
      this.show(project, root, result.pdf, { beside: true });
    }
  }

  /** The root (relative to the project folder) whose PDF the project's open preview shows. */
  private shownRoot(projectFolder: string): string | undefined {
    return this.panels.has(projectFolder) ? this.shown.get(projectFolder) : undefined;
  }

  hasPreview(projectFolder: string): boolean {
    return this.panels.has(projectFolder);
  }

  /** Closes the project's open preview. */
  close(projectFolder: string): void {
    const panel = this.panels.get(projectFolder);
    if (!panel) { return; }
    // dispose() detaches the panel's close listener, so the maps are cleared here.
    this.panels.delete(projectFolder);
    this.shown.delete(projectFolder);
    panel.dispose();
    void this.deps.host.current()?.logger.log("INFO", PREVIEW_LOG_MODULE, "Closed preview", { projectFolder });
  }

  /** Opens the project's preview on a root's PDF, switches the open one to it, or reveals the open one. */
  show(project: ReadyProject, root: string, pdf: string, options: { beside: boolean }): void {
    const session = this.deps.host.current();
    if (!session) { return; }
    try {
      const open = this.panels.get(project.folder);
      if (open && this.shown.get(project.folder) !== root) {
        this.switchRoot(open, project, root, pdf, options);
        return;
      }
      const panel = ReaderPanel.createOrShow({ ...this.deps, logger: session.logger }, {
        key: `preview:${project.folder}`,
        paper: previewPaper(this.deps.paths, project, pdf),
        store: createPreviewStore(),
        pdfUri: vscode.Uri.file(pdf),
        rootDir: vscode.Uri.file(this.rootDir(project)),
        preview: createPreviewPorts({
          logger: session.logger, paths: this.deps.paths, projectFolder: project.folder, problems: () => this.problems.get(this.currentKey(project)) ?? [],
          synctex: () => this.synctex.load(project, this.shown.get(project.folder) ?? project.main),
          format: project.settings.format, listPapers: this.deps.listPapers,
          typstCites: () => this.typstCites.get(this.currentKey(project)) ?? [],
        }),
        onClosed: () => { this.panels.delete(project.folder); this.shown.delete(project.folder); },
        ...(options.beside ? { show: { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true } } : {}),
      });
      this.panels.set(project.folder, panel);
      this.shown.set(project.folder, root);
      const last = this.states.get(this.deps.paths.join(project.folder, root));
      if (last) { panel.controller.setBuildStatus(last.state, last.errors); }
      void session.logger.log("INFO", PREVIEW_LOG_MODULE, "Opened preview", { projectFolder: project.folder, root, pdf });
    } catch (error) {
      void session.logger.error(PREVIEW_LOG_MODULE, error, { projectFolder: project.folder, root, pdf });
    }
  }

  private switchRoot(panel: ReaderPanel, project: ReadyProject, root: string, pdf: string, options: { beside: boolean }): void {
    panel.showDocument(vscode.Uri.file(pdf), this.deps.paths.basename(pdf));
    panel.reveal(options.beside);
    this.shown.set(project.folder, root);
    this.synctex.invalidate(project.folder);
    // The banner follows the new root: its running or failed build, or cleared after a success.
    const last = this.states.get(this.deps.paths.join(project.folder, root)) ?? { state: "succeeded" as const, errors: 0 };
    panel.controller.setBuildStatus(last.state, last.errors);
    void this.deps.host.current()?.logger.log("INFO", PREVIEW_LOG_MODULE, "Switched preview to another root", { projectFolder: project.folder, root, pdf });
  }

  // The absolute path of the root the open preview shows, or of the main root before one is shown.
  private currentKey(project: ReadyProject): string {
    return this.deps.paths.join(project.folder, this.shown.get(project.folder) ?? project.main ?? "");
  }

  // INVARIANT: covers every root's PDF, since one panel switches between roots without being recreated.
  private rootDir(project: ReadyProject): string {
    return project.settings.format === "typst" ? this.deps.data.projectBuildDir(project.settings.id) : project.folder;
  }

  /** Scrolls the project's open preview to the output of a source line (1-based) and marks it. */
  async revealSource(project: ReadyProject, file: string, line: number): Promise<void> {
    const session = this.deps.host.current();
    const panel = this.panels.get(project.folder);
    if (!session || !panel) { return; }
    await revealInPreview({
      logger: session.logger, projectFolder: project.folder, synctex: () => this.synctex.load(project, this.shown.get(project.folder) ?? project.main),
      reveal: (point) => panel.controller.revealPoint(point),
    }, file, line);
  }
}
