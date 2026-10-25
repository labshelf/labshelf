// Keeps one reader preview per writing project: reloads it after a build, shows the build status and opens it when asked.
import * as vscode from "vscode";

import { ReaderPanel } from "../../reader/index.js";
import type { BuildListener, BuildTrigger, FinishedBuild } from "../build/index.js";
import type { ReadyProject } from "../buildRootDocument.js";
import { type BuildPreviewsDeps, previewPaper } from "./previewPanelInput.js";
import { type BodyPagesCount, createPreviewPorts } from "./previewPorts.js";
import { PREVIEW_LOG_MODULE } from "./previewStrings.js";
import { ProjectSynctex, revealInPreview } from "./synctex/index.js";
import { StaleSources } from "./staleSources.js";
import { vscodeSourceEvents } from "./vscodeSourceEvents.js";
import { RootBuilds } from "./buildRootBuilds.js";
import { RootsPublisher } from "./buildRootsSender.js";
import { createPreviewStore, type ILogger } from "@labshelf/core";
import type { CitationFixDeps } from "./citations/index.js";
import { projectActions } from "./projectActions.js";
import { createWritingActions } from "./buildRoot/index.js";

type ReaderSource = Parameters<typeof ReaderPanel.createOrShow>[1];

interface PreviewPanelContext {
  deps: BuildPreviewsDeps;
  logger: ILogger;
  project: ReadyProject;
  pdf: string;
  builds: RootBuilds;
  synctex: ProjectSynctex;
  /** The root (relative to the project folder) the preview shows, or undefined before one is shown. */
  shownRoot: () => string | undefined;
  bodyPages: (root: string, contentPages: number) => void;
  /** Sends the open preview's roots again. */
  resendRoots: () => void;
  reveal: (file: string, line: number) => Promise<void>;
  onClosed: () => void;
  beside: boolean;
}

// INVARIANT: the project is read from the open projects on every call, since a reload replaces its entry.
function currentProject(deps: BuildPreviewsDeps, folder: string): ReadyProject | undefined {
  const entry = deps.projects.list().find((candidate) => candidate.kind === "ready" && candidate.folder === folder);
  return entry?.kind === "ready" ? entry : undefined;
}

function previewProjectActions(context: PreviewPanelContext, fixes: () => CitationFixDeps | undefined) {
  const { deps, logger, project, shownRoot } = context;
  const { includeOnly } = deps;
  if (!includeOnly) { return undefined; }
  return projectActions({
    logger, project: () => currentProject(deps, project.folder), projects: deps.projects,
    setEngine: deps.setEngine, includeOnly, fixes, resendRoots: context.resendRoots,
    recompile: () => {
      deps.recompile(project.folder, shownRoot() ?? project.main ?? "").catch((error: unknown) => {
        void logger.error(PREVIEW_LOG_MODULE, error, { projectFolder: project.folder, action: "recompile" });
      });
    },
  });
}

function previewPanelSource(context: PreviewPanelContext): ReaderSource {
  const { deps, logger, project, pdf, builds, synctex, shownRoot } = context;
  const fixes = (): CitationFixDeps | undefined => deps.fixes(project.folder);
  const actions = previewProjectActions(context, fixes);
  return {
    key: `preview:${project.folder}`,
    paper: previewPaper(deps.paths, project, pdf),
    store: createPreviewStore(),
    pdfUri: deps.uriOf(pdf),
    rootDir: deps.uriOf(previewRootDir(deps, project)),
    preview: createPreviewPorts({
      bodyPages: context.bodyPages, fixes, ...(actions && { projectActions: actions }),
      logger, paths: deps.paths, projectFolder: project.folder, format: project.settings.format, listPapers: deps.listPapers,
      highlightsOf: deps.highlightsOf,
      synctex: () => synctex.load(project, shownRoot() ?? project.main),
      typstCites: () => builds.citesOf(project.folder, shownRoot() ?? project.main ?? "") ?? [],
      actions: createWritingActions({
        logger, paths: deps.paths, data: deps.data, project, recompile: deps.recompile,
        shownRoot: () => shownRoot() ?? project.main ?? "",
        problemsOf: (reported) => builds.problemsOf(project.folder, reported),
        reveal: context.reveal,
      }),
    }),
    onClosed: context.onClosed,
    ...(context.beside ? { show: { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true } } : {}),
  };
}

// INVARIANT: covers every root's PDF, since one panel switches between roots without being recreated.
function previewRootDir(deps: BuildPreviewsDeps, project: ReadyProject): string {
  return project.settings.format === "typst" ? deps.data.projectBuildDir(project.settings.id) : project.folder;
}

export class BuildPreviews implements BuildListener {
  private readonly panels = new Map<string, ReaderPanel>();
  // The root (relative to the project folder) whose PDF each project's open preview shows; its banner and reloads follow only that root.
  private readonly shown = new Map<string, string>();
  /** The last build of every root a project has built, for views that summarise builds. */
  readonly builds: RootBuilds;
  private readonly synctex: ProjectSynctex;
  private readonly stale: StaleSources;
  private readonly roots: RootsPublisher;
  private readonly bodyPagesCounted = new vscode.EventEmitter<BodyPagesCount>();
  /** Fires when a preview's reader reports the body pages of the root it shows. */
  readonly onDidCountBodyPages = this.bodyPagesCounted.event;
  private readonly rootBuildChanged = new vscode.EventEmitter<void>();
  /** Fires when a root's build starts or finishes. */
  readonly onDidChangeRootBuild = this.rootBuildChanged.event;

  constructor(private readonly deps: BuildPreviewsDeps) {
    this.builds = new RootBuilds(deps.paths);
    this.synctex = new ProjectSynctex(deps.host, deps.paths, deps.data);
    this.stale = new StaleSources(deps.paths, vscodeSourceEvents, Date.now, (folder, root) => this.resendStatus(folder, root));
    this.roots = new RootsPublisher(deps, { panels: this.panels, shown: this.shown, builds: this.builds, synctex: this.synctex });
  }

  dispose(): void {
    this.roots.dispose();
    this.stale.dispose();
    this.bodyPagesCounted.dispose();
    this.rootBuildChanged.dispose();
  }

  /** Sends the roots of every open preview again. */
  resendRoots(): void {
    this.roots.resendAll();
  }

  // An edit sends the shown root's state again with `stale` set; only a successful build clears it.
  private resendStatus(projectFolder: string, root: string): void {
    if (this.shownRoot(projectFolder) !== root) { return; }
    const last = this.builds.stateOf(projectFolder, root) ?? { state: "succeeded" as const, errors: 0 };
    this.panels.get(projectFolder)?.controller.setBuildStatus(last.state, last.errors, this.stale.statusOf(projectFolder, root));
  }

  /** Tells an open preview that a build of the root it shows started. */
  building(projectFolder: string, root: string): void {
    this.builds.started(projectFolder, root);
    this.rootBuildChanged.fire();
    this.stale.building(projectFolder, root);
    if (this.shownRoot(projectFolder) === root) { this.panels.get(projectFolder)?.controller.setBuildStatus("building", 0, this.stale.statusOf(projectFolder, root)); }
  }

  /** Reloads an open preview after a build of the root it shows, or opens one when the build was asked for with the command. */
  finished(project: ReadyProject, root: string, result: FinishedBuild, trigger: BuildTrigger): void {
    this.roots.invalidate(project.folder, root);
    this.applyFinished(project, root, result, trigger);
    // A failed main build opens the reader's logs once the reader knows the roots.
    const logsOf = result.status === "failed" && root === project.main ? root : undefined;
    void this.roots.publish(project).then(() => { if (logsOf !== undefined) { this.panels.get(project.folder)?.controller.showLogs(logsOf); } });
  }

  private applyFinished(project: ReadyProject, root: string, result: FinishedBuild, trigger: BuildTrigger): void {
    const errors = this.builds.finished(project.folder, root, result);
    this.rootBuildChanged.fire();
    if (result.status === "failed") { this.stale.failed(project.folder, root); } else { this.stale.succeeded(project.folder, root); }
    const status = this.stale.statusOf(project.folder, root);
    const shown = this.shownRoot(project.folder);
    const panel = shown === root ? this.panels.get(project.folder) : undefined;
    if (result.status === "failed") {
      panel?.controller.setBuildStatus("failed", errors, status);
      return;
    }
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
      panel.controller.setBuildStatus("succeeded", 0, status);
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
      const panel = ReaderPanel.createOrShow({ ...this.deps, logger: session.logger }, previewPanelSource({
        deps: this.deps, logger: session.logger, project, pdf, builds: this.builds, synctex: this.synctex, beside: options.beside,
        shownRoot: () => this.shown.get(project.folder),
        resendRoots: () => this.roots.resend(project.folder),
        bodyPages: (reported, contentPages) => this.bodyPagesCounted.fire({ folder: project.folder, root: reported, contentPages }),
        reveal: (file, line) => this.revealSource(project, file, line),
        onClosed: () => { this.panels.delete(project.folder); this.shown.delete(project.folder); },
      }));
      this.panels.set(project.folder, panel);
      this.shown.set(project.folder, root);
      const last = this.builds.stateOf(project.folder, root);
      if (last) { panel.controller.setBuildStatus(last.state, last.errors, this.stale.statusOf(project.folder, root)); }
      void this.roots.publish(project);
      void session.logger.log("INFO", PREVIEW_LOG_MODULE, "Opened preview", { projectFolder: project.folder, root, pdf });
    } catch (error) {
      void session.logger.error(PREVIEW_LOG_MODULE, error, { projectFolder: project.folder, root, pdf });
    }
  }

  private switchRoot(panel: ReaderPanel, project: ReadyProject, root: string, pdf: string, options: { beside: boolean }): void {
    panel.showDocument(this.deps.uriOf(pdf), this.deps.paths.basename(pdf));
    panel.reveal(options.beside);
    this.shown.set(project.folder, root);
    this.synctex.invalidate(project.folder);
    // The banner follows the new root: its running or failed build, or cleared after a success.
    const last = this.builds.stateOf(project.folder, root) ?? { state: "succeeded" as const, errors: 0 };
    panel.controller.setBuildStatus(last.state, last.errors, this.stale.statusOf(project.folder, root));
    void this.roots.publish(project);
    void this.deps.host.current()?.logger.log("INFO", PREVIEW_LOG_MODULE, "Switched preview to another root", { projectFolder: project.folder, root, pdf });
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
