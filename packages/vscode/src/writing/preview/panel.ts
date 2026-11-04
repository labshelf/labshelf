// Keeps one reader preview per writing project: reloads it after a build, shows the build status, follows the focused file's root and opens it when asked.
import * as vscode from "vscode";

import type { Annotation, CheckCounts, FinishedBuild, LatexEngine, PaperRecord, PathOps, ProjectContentPort, ProjectFormat } from "@labshelf/core";
import { BuildRootBuilds, ProjectSynctex, StaleSources, buildTypstPreviewPdf, deriveBuiltPdfPath, isDeckFileCandidate, readDeckFileKind, type SourceEvents } from "@labshelf/core";
import { disposeAll } from "../../disposables/index.js";
import { ReaderPanel, type ReaderPanelDeps } from "../../reader/index.js";
import type { UriOfPath } from "../../library/index.js";
import type { ActiveSource } from "../activeSource.js";
import { BUILD_COMMAND, readActiveProject, type BuildListener, type BuildTrigger, type IncludeOnlyState } from "../build/index.js";
import { findOwningProject, type ReadyProject } from "../projects/index.js";
import type { BuildRootOf, WritingHost, WritingProjects } from "../projects/index.js";
import { BuildRootsPublisher } from "./buildRootsPublisher.js";
import type { CitationFixDeps } from "./citationFixes.js";
import { previewPanelSource } from "./previewPanelSource.js";
import type { BodyPagesCount } from "./ports.js";
import { showInPreview } from "./synctex.js";

/** The module name the preview logs under. */
export const PREVIEW_LOG_MODULE = "writing/preview";
/** Tells the user the preview has no build to link to the source yet. */
export const NOT_BUILT_MESSAGE = "Build the project to link the preview to the source.";
/** Tells the user Typst projects do not offer preview and source jumps yet. */
export const TYPST_SOURCE_LINKS_MESSAGE = "Jumping between preview and source works in LaTeX projects; Typst projects do not offer it yet.";
/** Tells the user a preview click maps to no source line. */
export const NO_SOURCE_MESSAGE = "No source line found here.";
/** Tells the user the file is not part of the built document. */
export const NOT_IN_PREVIEW_MESSAGE = "This file is not part of the built document.";

/** Describes what a build preview needs from its host. */
export interface BuildPreviewsDeps extends Pick<ReaderPanelDeps, "extensionUri" | "locatePdfjs" | "isMac"> {
  host: Pick<WritingHost, "current">;
  listPapers: () => Promise<PaperRecord[]>;
  highlightsOf: (paperId: string) => Promise<Annotation[]>;
  paths: PathOps;
  /** The URI VS Code reads a path by. */
  uriOf: UriOfPath;
  data: ProjectContentPort;
  /** The root the editor file builds into. */
  buildRootOf: BuildRootOf;
  /** Builds a root of the project again. */
  recompile: (projectFolder: string, root: string) => Promise<unknown>;
  /** The open projects; the preview sends its roots again when they reload. */
  projects: Pick<WritingProjects, "list" | "onDidChange" | "data" | "paths" | "reload" | "fs">;
  /** The finding count of each project's last check. */
  checkCounts: CheckCounts;
  /** Stores the engine a LaTeX project builds with. */
  setEngine: (project: ReadyProject, engine: LatexEngine) => Promise<void>;
  /** The citation-card fixes for a project folder; undefined while no library is open. */
  fixes: (projectFolder: string) => CitationFixDeps | undefined;
  /** Offers the include-only toggle and the toolbar's project actions; absent where builds cannot run. */
  includeOnly?: Pick<IncludeOnlyState, "option" | "set">;
  /** The focused source editor, native or LabShelf; absent, the active text editor is the source. */
  activeSource?: Pick<ActiveSource, "current" | "openFor" | "onDidChange">;
}

/** Finds the PDF the preview shows for a root: for LaTeX the one its last successful build left next to the root file, for Typst the last live compile; `undefined` when there is no root or it has not been built. */
export async function readBuiltPdf(projects: Pick<WritingProjects, "data" | "paths" | "fs">, project: ReadyProject | undefined, root: string | undefined): Promise<string | undefined> {
  if (!project || !root) { return undefined; }
  // INVARIANT: `root` is project-relative with "/" separators on every platform.
  const pdf = project.settings.format === "typst"
    ? buildTypstPreviewPdf(project, root, projects.data, projects.paths)
    : deriveBuiltPdfPath(projects.paths, project, root);
  if (!pdf) { return undefined; }
  return await projects.fs.exists(pdf).then((found) => (found ? pdf : undefined), () => undefined);
}

/** Reports saved and edited files of the workspace as source changes. */
const vscodeSourceEvents: SourceEvents = {
  onSourceChanged(listener) {
    const subscriptions = [
      vscode.workspace.onDidSaveTextDocument((document) => { if (document.uri.scheme === "file") { listener(document.uri.fsPath); } }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document.uri.scheme === "file" && event.contentChanges.length > 0) { listener(event.document.uri.fsPath); }
      }),
    ];
    return { dispose: () => disposeAll(subscriptions) };
  },
};

/** What the focus follower reads and drives. */
export interface FocusFollowerDeps {
  session: { readonly project: ReadyProject | undefined };
  projects: Pick<WritingProjects, "list" | "paths" | "data" | "fs">;
  buildRootOf: BuildRootOf;
  builders: Record<ProjectFormat, { request(projectFolder: string, root: string, trigger: "focus"): Promise<unknown> }>;
  previews: { show(project: ReadyProject, root: string, pdf: string, options: { beside: boolean }): void; close(projectFolder: string): void };
  host: Pick<WritingHost, "current">;
  /** The focused source editor, native or LabShelf; its changes are what the preview follows. */
  activeSource: Pick<ActiveSource, "onDidChange">;
}

/** Whether a file is a talk or poster, read from its content on disk; a file that cannot be read is not one. */
async function isDeckFile(projects: Pick<WritingProjects, "fs">, file: string): Promise<boolean> {
  if (!isDeckFileCandidate(file)) { return false; }
  try {
    return readDeckFileKind(file, await projects.fs.readText(file)) !== undefined;
  } catch {
    return false;
  }
}

/** Keeps the open project's preview on the PDF of the focused file's build root, building the root only when it has no PDF; a talk or poster closes it, as its own workspace shows its PDF. */
export class FocusFollower implements vscode.Disposable {
  private readonly subscription: vscode.Disposable;

  constructor(private readonly deps: FocusFollowerDeps) {
    this.subscription = deps.activeSource.onDidChange((source) => {
      const uri = source?.uri;
      if (uri?.scheme === "file") { void this.follow(uri.fsPath); }
    });
  }

  /** Shows the PDF of the root the file belongs to; asks for a build only when that root has none. */
  async follow(file: string): Promise<void> {
    const { session, projects, previews } = this.deps;
    const project = session.project;
    if (!project?.main || findOwningProject(projects, file)?.folder !== project.folder) { return; }
    if (await isDeckFile(projects, file)) {
      previews.close(project.folder);
      return;
    }
    try {
      const root = await this.deps.buildRootOf(project.folder, project.main, file);
      const pdf = await readBuiltPdf(projects, project, root);
      if (pdf) {
        previews.show(project, root, pdf, { beside: true });
        return;
      }
      const mainPdf = await readBuiltPdf(projects, project, project.main);
      if (mainPdf) { previews.show(project, project.main, mainPdf, { beside: true }); }
      void this.deps.host.current()?.logger.log("INFO", PREVIEW_LOG_MODULE, "Building the focused root", { projectFolder: project.folder, root });
      await this.deps.builders[project.settings.format].request(project.folder, root, "focus");
    } catch (error) {
      void this.deps.host.current()?.logger.error(PREVIEW_LOG_MODULE, error, { projectFolder: project.folder, file });
    }
  }

  dispose(): void {
    this.subscription.dispose();
  }
}

/** Keeps one reader preview per writing project: reloads it after a build, shows the build status and opens it when asked. */
const previewOpened = new vscode.EventEmitter<string>();
const openFolders = new Set<string>();

/** Which projects have their preview open, for the LabShelf editors' PDF toggle; fires with the project folder whose preview opened or closed. */
export const previewVisibility = {
  isOpen: (projectFolder: string): boolean => openFolders.has(projectFolder),
  onDidChange: previewOpened.event,
};

function markPreviewOpen(projectFolder: string, open: boolean): void {
  if (openFolders.has(projectFolder) === open) { return; }
  if (open) { openFolders.add(projectFolder); } else { openFolders.delete(projectFolder); }
  previewOpened.fire(projectFolder);
}

export class BuildPreviews implements BuildListener {
  private readonly panels = new Map<string, ReaderPanel>();
  // The root (relative to the project folder) whose PDF each project's open preview shows; its banner and reloads follow only that root.
  private readonly shown = new Map<string, string>();
  /** The last build of every root a project has built, for views that summarise builds. */
  readonly builds: BuildRootBuilds;
  private readonly synctex: ProjectSynctex;
  private readonly stale: StaleSources;
  private readonly roots: BuildRootsPublisher;
  private readonly bodyPagesCounted = new vscode.EventEmitter<BodyPagesCount>();
  /** Fires when a preview's reader reports the body pages of the root it shows. */
  readonly onDidCountBodyPages = this.bodyPagesCounted.event;
  private readonly rootBuildChanged = new vscode.EventEmitter<void>();
  /** Fires when a root's build starts or finishes. */
  readonly onDidChangeRootBuild = this.rootBuildChanged.event;

  constructor(private readonly deps: BuildPreviewsDeps) {
    this.builds = new BuildRootBuilds(deps.paths);
    this.synctex = new ProjectSynctex(deps.host, deps.paths, deps.data);
    this.stale = new StaleSources(deps.paths, vscodeSourceEvents, Date.now, (folder, root) => this.resendStatus(folder, root));
    this.roots = new BuildRootsPublisher(deps, { panels: this.panels, shown: this.shown, builds: this.builds, synctex: this.synctex });
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
      // A talk's or poster's workspace builds its root with this trigger and shows the PDF itself.
      const pdf = result.pdf;
      void isDeckFile(this.deps.projects, this.deps.paths.join(project.folder, root)).then((deck) => { if (!deck) { this.show(project, root, pdf, { beside: true }); } });
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
    markPreviewOpen(projectFolder, false);
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
        onClosed: () => { this.panels.delete(project.folder); this.shown.delete(project.folder); markPreviewOpen(project.folder, false); },
      }));
      this.panels.set(project.folder, panel);
      markPreviewOpen(project.folder, true);
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
    await showInPreview({
      logger: session.logger, projectFolder: project.folder, synctex: () => this.synctex.load(project, this.shown.get(project.folder) ?? project.main),
      reveal: (point) => panel.controller.revealPoint(point),
    }, file, line);
  }
}

const SHOW_PREVIEW_COMMAND = "labshelf.writing.showPreview";

interface ShowPreviewDeps {
  context: vscode.ExtensionContext;
  projects: Pick<WritingProjects, "data" | "list" | "paths" | "fs">;
  previews: Pick<BuildPreviews, "show" | "hasPreview" | "close">;
  activeSource?: Pick<ActiveSource, "current">;
}

async function showPreview(deps: ShowPreviewDeps): Promise<void> {
  const project = readActiveProject(deps.projects, deps.activeSource);
  const pdf = await readBuiltPdf(deps.projects, project, project?.main);
  if (project?.main && pdf) {
    // Beside the source, as the build opens it: the editor's toolbar runs this and must not cover its own text.
    deps.previews.show(project, project.main, pdf, { beside: true });
    return;
  }
  // The build command opens the preview on success and explains a missing project, main file or format.
  await vscode.commands.executeCommand(BUILD_COMMAND);
}

const TOGGLE_PREVIEW_COMMAND = "labshelf.writing.togglePreview";

/** Closes the active project's open preview, or shows it as Show Preview does: the LabShelf editor's eye button. */
async function togglePreview(deps: ShowPreviewDeps): Promise<void> {
  const project = readActiveProject(deps.projects, deps.activeSource);
  if (project && deps.previews.hasPreview(project.folder)) { deps.previews.close(project.folder); return; }
  await showPreview(deps);
}

/** Registers Show Preview: opens the active project's built PDF in the reader, building it first when it does not exist; and its toggle. */
export function registerShowPreview(deps: ShowPreviewDeps): void {
  deps.context.subscriptions.push(
    vscode.commands.registerCommand(SHOW_PREVIEW_COMMAND, () => showPreview(deps)),
    vscode.commands.registerCommand(TOGGLE_PREVIEW_COMMAND, () => togglePreview(deps)),
  );
}
