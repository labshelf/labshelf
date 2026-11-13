// Keeps one reader preview per writing project: reloads it after a build, shows the build status, follows the focused file's root and opens it when asked.
import * as vscode from "vscode";

import type { Annotation, CheckCounts, FinishedBuild, ItemFile, LatexEngine, PaperRecord, PathOps, ProjectContentPort, ProjectFormat } from "@labshelf/core";
import { BuildRootBuilds, ProjectSynctex, StaleSources, buildTypstPreviewPdf, deriveBuiltPdfPath, isDeckFileCandidate, readDeckFileKind, type SourceEvents } from "@labshelf/core";
import { disposeAll } from "../../disposables/index.js";
import { ReaderPanel, type ReaderEndpoint, type ReaderPanelDeps, type ReaderSource } from "../../reader/index.js";
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
  /** The paper's notes, for the citation card. */
  notesOf?: (paperId: string) => Promise<ItemFile>;
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
  /** Keeps whether the article tabs show their inline preview (the global state); without it the panes start shown and forget. */
  state?: Pick<vscode.Memento, "get" | "update">;
}

/** The global state key of whether the article tabs show their inline preview. */
export const INLINE_SHOWN_KEY = "labshelf.inlinePreview.shown";

/** The reader calls a preview makes. */
type PreviewReader = Pick<ReaderEndpoint["controller"], "setBuildStatus" | "reloadDocument" | "setPreviewRoots" | "revealPoint" | "showLogs">;

/** The preview inside an article's LabShelf editor tab; its owner creates and disposes it, BuildPreviews only drives it while attached. */
export interface InlinePreviewEndpoint {
  readonly controller: PreviewReader;
  showDocument(pdf: vscode.Uri, title: string): void;
  /** Shows or hides the tab's pane. */
  setShown(shown: boolean): void;
}

/** What an article tab's preview starts from: the reader deps and source of its project, and the root it shows. */
export interface InlinePreviewStart {
  deps: ReaderPanelDeps;
  source: ReaderSource;
  root: string;
}

/** The part of BuildPreviews the LabShelf editor's inline previews use. */
export type InlinePreviewHost = Pick<BuildPreviews, "prepareInline" | "attachInline" | "focusInline" | "setInlineShown" | "inlineShown">;

/** Finds the PDF the preview shows for a root: for LaTeX the one its last successful build left next to the root file, for Typst the last live compile; `undefined` when there is no root or it has not been built. */
export async function readBuiltPdf(projects: Pick<WritingProjects, "data" | "paths" | "fs">, project: ReadyProject | undefined, root: string | undefined): Promise<string | undefined> {
  if (!project || !root) { return undefined; }
  // INVARIANT: `root` is project-relative with "/" separators on every platform.
  const pdf = expectedPdf(projects, project, root);
  if (!pdf) { return undefined; }
  return await projects.fs.exists(pdf).then((found) => (found ? pdf : undefined), () => undefined);
}

/** The PDF a root builds to, whether or not it exists yet. */
function expectedPdf(projects: Pick<WritingProjects, "data" | "paths">, project: ReadyProject, root: string): string | undefined {
  return project.settings.format === "typst"
    ? buildTypstPreviewPdf(project, root, projects.data, projects.paths)
    : deriveBuiltPdfPath(projects.paths, project, root);
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

// Whether a project shows its preview inside its article tabs, and then whether the panes are shown; undefined for a project without one.
let inlineOpen: (projectFolder: string) => boolean | undefined = () => undefined;

/** Which projects have their preview open, for the LabShelf editors' PDF toggle; fires with the project folder whose preview opened or closed. */
export const previewVisibility = {
  isOpen: (projectFolder: string): boolean => inlineOpen(projectFolder) ?? openFolders.has(projectFolder),
  onDidChange: previewOpened.event,
};

let inlineHost: InlinePreviewHost | undefined;

/** Makes a BuildPreviews the one the LabShelf editor's article tabs attach to; the returned disposable withdraws it. */
export function provideInlinePreviews(previews: InlinePreviewHost): vscode.Disposable {
  inlineHost = previews;
  return { dispose: () => { if (inlineHost === previews) { inlineHost = undefined; } } };
}

/** The previews the article tabs attach to; undefined before the writing view registers them. */
export function currentInlinePreviews(): InlinePreviewHost | undefined {
  return inlineHost;
}

function markPreviewOpen(projectFolder: string, open: boolean): void {
  if (openFolders.has(projectFolder) === open) { return; }
  if (open) { openFolders.add(projectFolder); } else { openFolders.delete(projectFolder); }
  previewOpened.fire(projectFolder);
}

export class BuildPreviews implements BuildListener {
  private readonly panels = new Map<string, ReaderPanel>();
  // INVARIANT: a project with inline previews has no panel; the first inline preview closes it and none opens while one is attached.
  private readonly inline = new Map<string, Set<InlinePreviewEndpoint>>();
  private focusedInline: InlinePreviewEndpoint | undefined;
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
    this.roots = new BuildRootsPublisher(deps, { readers: { folders: () => this.previewFolders(), of: (folder) => this.readersOf(folder) }, shown: this.shown, builds: this.builds, synctex: this.synctex });
    inlineOpen = (folder) => (this.inline.has(folder) ? this.inlineShown() : undefined);
  }

  /** The folders with an open preview, in a panel or inline. */
  private previewFolders(): string[] {
    return [...new Set([...this.panels.keys(), ...this.inline.keys()])];
  }

  /** Every reader that shows the project's preview: its panel, or its article tabs' previews. */
  private readersOf(projectFolder: string): PreviewReader[] {
    const inline = this.inline.get(projectFolder);
    if (inline) { return [...inline].map((endpoint) => endpoint.controller); }
    const panel = this.panels.get(projectFolder);
    return panel ? [panel.controller] : [];
  }

  /** The reader one-off requests go to (a revealed point, the logs): the panel, else the article tab focused last. */
  private primaryReader(projectFolder: string): PreviewReader | undefined {
    const inline = this.inline.get(projectFolder);
    if (!inline) { return this.panels.get(projectFolder)?.controller; }
    const focused = this.focusedInline && inline.has(this.focusedInline) ? this.focusedInline : [...inline].at(-1);
    return focused?.controller;
  }

  /** Whether the article tabs show their preview, shared by all of them. */
  inlineShown(): boolean {
    return this.deps.state?.get<boolean>(INLINE_SHOWN_KEY) !== false;
  }

  /** Shows or hides the preview of every article tab, and remembers it. */
  setInlineShown(shown: boolean): void {
    if (this.deps.state && this.inlineShown() !== shown) {
      void Promise.resolve(this.deps.state.update(INLINE_SHOWN_KEY, shown)).catch((error: unknown) => {
        void this.deps.host.current()?.logger.error(PREVIEW_LOG_MODULE, error, { action: "storeInlineShown" });
      });
    }
    for (const [folder, endpoints] of this.inline) {
      for (const endpoint of endpoints) { endpoint.setShown(shown); }
      previewOpened.fire(folder);
    }
  }

  /** What an article tab of the project starts its preview with: the root the project's preview shows, else the file's own root, and its PDF (built or not yet). */
  async prepareInline(project: ReadyProject, file: string): Promise<InlinePreviewStart | undefined> {
    const session = this.deps.host.current();
    if (!session || !project.main) { return undefined; }
    const root = this.shownRoot(project.folder) ?? await this.deps.buildRootOf(project.folder, project.main, file).catch(() => project.main!);
    const pdf = await readBuiltPdf(this.deps.projects, project, root) ?? expectedPdf(this.deps.projects, project, root);
    if (!pdf) { return undefined; }
    const source = this.previewSource(project, pdf, false);
    return { deps: { ...this.deps, logger: session.logger }, source, root };
  }

  /**
   * Lets an article tab's preview show the project's builds: reloads, build status and roots reach it, and no separate panel opens while it is attached.
   * @returns the disposable that detaches it.
   */
  attachInline(projectFolder: string, endpoint: InlinePreviewEndpoint, root: string): vscode.Disposable {
    if (this.panels.has(projectFolder)) { this.close(projectFolder); }
    let endpoints = this.inline.get(projectFolder);
    const first = !endpoints;
    if (!endpoints) { endpoints = new Set(); this.inline.set(projectFolder, endpoints); }
    endpoints.add(endpoint);
    if (!this.shown.has(projectFolder)) { this.shown.set(projectFolder, root); }
    const shown = this.shown.get(projectFolder)!;
    const last = this.builds.stateOf(projectFolder, shown);
    if (last) { endpoint.controller.setBuildStatus(last.state, last.errors, this.stale.statusOf(projectFolder, shown)); }
    endpoint.setShown(this.inlineShown());
    if (first) { previewOpened.fire(projectFolder); }
    this.roots.resend(projectFolder);
    return { dispose: () => this.detachInline(projectFolder, endpoint) };
  }

  private detachInline(projectFolder: string, endpoint: InlinePreviewEndpoint): void {
    const endpoints = this.inline.get(projectFolder);
    if (!endpoints?.delete(endpoint)) { return; }
    if (this.focusedInline === endpoint) { this.focusedInline = undefined; }
    if (endpoints.size > 0) { return; }
    this.inline.delete(projectFolder);
    if (!this.panels.has(projectFolder)) { this.shown.delete(projectFolder); }
    previewOpened.fire(projectFolder);
  }

  /** Marks the article tab focused last, which revealed points and logs go to. */
  focusInline(endpoint: InlinePreviewEndpoint): void {
    this.focusedInline = endpoint;
  }

  /** Whether the project shows its preview inside its article tabs. */
  hasInline(projectFolder: string): boolean {
    return this.inline.has(projectFolder);
  }

  private previewSource(project: ReadyProject, pdf: string, beside: boolean, onClosed: () => void = () => {}): ReaderSource {
    const logger = this.deps.host.current()!.logger;
    return previewPanelSource({
      deps: this.deps, logger, project, pdf, builds: this.builds, synctex: this.synctex, beside,
      shownRoot: () => this.shown.get(project.folder),
      resendRoots: () => this.roots.resend(project.folder),
      bodyPages: (reported, contentPages) => this.bodyPagesCounted.fire({ folder: project.folder, root: reported, contentPages }),
      reveal: (file, line) => this.revealSource(project, file, line),
      onClosed,
    });
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
    for (const reader of this.readersOf(projectFolder)) { reader.setBuildStatus(last.state, last.errors, this.stale.statusOf(projectFolder, root)); }
  }

  /** Tells an open preview that a build of the root it shows started. */
  building(projectFolder: string, root: string): void {
    this.builds.started(projectFolder, root);
    this.rootBuildChanged.fire();
    this.stale.building(projectFolder, root);
    if (this.shownRoot(projectFolder) === root) {
      for (const reader of this.readersOf(projectFolder)) { reader.setBuildStatus("building", 0, this.stale.statusOf(projectFolder, root)); }
    }
  }

  /** Reloads an open preview after a build of the root it shows, or opens one when the build was asked for with the command. */
  finished(project: ReadyProject, root: string, result: FinishedBuild, trigger: BuildTrigger): void {
    this.roots.invalidate(project.folder, root);
    this.applyFinished(project, root, result, trigger);
    // A failed main build asked for with the command opens the reader's logs once the reader knows the roots. A build on save
    // keeps the PDF: the logs view takes focus, which would leave the editor and close its completion list mid-word.
    const logsOf = result.status === "failed" && root === project.main && trigger === "command" ? root : undefined;
    void this.roots.publish(project).then(() => { if (logsOf !== undefined) { this.primaryReader(project.folder)?.showLogs(logsOf); } });
  }

  private applyFinished(project: ReadyProject, root: string, result: FinishedBuild, trigger: BuildTrigger): void {
    const errors = this.builds.finished(project.folder, root, result);
    this.rootBuildChanged.fire();
    if (result.status === "failed") { this.stale.failed(project.folder, root); } else { this.stale.succeeded(project.folder, root); }
    const status = this.stale.statusOf(project.folder, root);
    const shown = this.shownRoot(project.folder);
    const readers = shown === root ? this.readersOf(project.folder) : [];
    if (result.status === "failed") {
      for (const reader of readers) { reader.setBuildStatus("failed", errors, status); }
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
    if (readers.length > 0) {
      if (project.settings.format === "latex") { void this.synctex.load(project, root); }
      for (const reader of readers) {
        reader.reloadDocument();
        reader.setBuildStatus("succeeded", 0, status);
      }
      void this.deps.host.current()?.logger.log("INFO", PREVIEW_LOG_MODULE, "Reloaded preview", { projectFolder: project.folder, root, pdf: result.pdf });
    } else if (trigger === "command") {
      this.show(project, root, result.pdf, { beside: true, reveal: true });
    }
  }

  /** The root (relative to the project folder) whose PDF the project's open preview shows. */
  private shownRoot(projectFolder: string): string | undefined {
    return this.hasPreview(projectFolder) ? this.shown.get(projectFolder) : undefined;
  }

  /** Whether the project shows its preview, in a panel or inside its article tabs. */
  hasPreview(projectFolder: string): boolean {
    return this.panels.has(projectFolder) || this.inline.has(projectFolder);
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

  /**
   * Opens the project's preview on a root's PDF, switches the open one to it, or reveals the open one.
   * Inside the article tabs the panes are shown only with `reveal` (a command asked for the preview); following the focus keeps them as the user left them.
   */
  show(project: ReadyProject, root: string, pdf: string, options: { beside: boolean; reveal?: boolean }): void {
    const session = this.deps.host.current();
    if (!session) { return; }
    try {
      if (this.inline.has(project.folder)) {
        this.showInline(project, root, pdf, options.reveal === true);
        return;
      }
      const open = this.panels.get(project.folder);
      if (open && this.shown.get(project.folder) !== root) {
        this.switchRoot(open, project, root, pdf, options);
        return;
      }
      const panel = ReaderPanel.createOrShow({ ...this.deps, logger: session.logger }, this.previewSource(project, pdf, options.beside,
        () => { this.panels.delete(project.folder); this.shown.delete(project.folder); markPreviewOpen(project.folder, false); }));
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

  // The article tabs switch together to the root's PDF; the banner follows the new root as in a panel.
  private showInline(project: ReadyProject, root: string, pdf: string, reveal: boolean): void {
    if (this.shown.get(project.folder) !== root) {
      this.shown.set(project.folder, root);
      this.synctex.invalidate(project.folder);
      const last = this.builds.stateOf(project.folder, root) ?? { state: "succeeded" as const, errors: 0 };
      for (const endpoint of this.inline.get(project.folder) ?? []) {
        endpoint.showDocument(this.deps.uriOf(pdf), this.deps.paths.basename(pdf));
        endpoint.controller.setBuildStatus(last.state, last.errors, this.stale.statusOf(project.folder, root));
      }
      void this.roots.publish(project);
      void this.deps.host.current()?.logger.log("INFO", PREVIEW_LOG_MODULE, "Switched inline preview to another root", { projectFolder: project.folder, root, pdf });
    }
    if (reveal && !this.inlineShown()) { this.setInlineShown(true); }
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
    const reader = this.primaryReader(project.folder);
    if (!session || !reader) { return; }
    await showInPreview({
      logger: session.logger, projectFolder: project.folder, synctex: () => this.synctex.load(project, this.shown.get(project.folder) ?? project.main),
      reveal: (point) => reader.revealPoint(point),
    }, file, line);
  }
}

const SHOW_PREVIEW_COMMAND = "labshelf.writing.showPreview";

interface ShowPreviewDeps {
  context: vscode.ExtensionContext;
  projects: Pick<WritingProjects, "data" | "list" | "paths" | "fs">;
  /** The inline part is absent where article tabs show no preview of their own. */
  previews: Pick<BuildPreviews, "show" | "hasPreview" | "close"> & Partial<Pick<BuildPreviews, "hasInline" | "inlineShown" | "setInlineShown">>;
  activeSource?: Pick<ActiveSource, "current">;
}

async function showPreview(deps: ShowPreviewDeps): Promise<void> {
  const project = readActiveProject(deps.projects, deps.activeSource);
  const pdf = await readBuiltPdf(deps.projects, project, project?.main);
  if (project?.main && pdf) {
    // Beside the source, as the build opens it: the editor's toolbar runs this and must not cover its own text.
    deps.previews.show(project, project.main, pdf, { beside: true, reveal: true });
    return;
  }
  // The build command opens the preview on success and explains a missing project, main file or format.
  await vscode.commands.executeCommand(BUILD_COMMAND);
}

const TOGGLE_PREVIEW_COMMAND = "labshelf.writing.togglePreview";

/** Closes the active project's open preview, or shows it as Show Preview does: the LabShelf editor's eye button. */
async function togglePreview(deps: ShowPreviewDeps): Promise<void> {
  const project = readActiveProject(deps.projects, deps.activeSource);
  // A project shown inside its article tabs hides or shows the panes of them all.
  const { hasInline, inlineShown, setInlineShown } = deps.previews;
  if (project && hasInline && inlineShown && setInlineShown && hasInline.call(deps.previews, project.folder)) {
    setInlineShown.call(deps.previews, !inlineShown.call(deps.previews));
    return;
  }
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
