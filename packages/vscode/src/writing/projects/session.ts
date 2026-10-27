// The window's writing project session: the project list and host, the open project with its tabs and context keys, its commands and its save tracking.
import * as vscode from "vscode";

import {
  formatError, type ILogger, type LibraryFileSystem, type PathOps, type ProjectContentPort, type ProjectEntry, type ProjectReadContext, type ProjectWriteTracking,
} from "@labshelf/core";
import { runSafely } from "../../command/index.js";
import { BUILD_COMMAND } from "../build/index.js";
import { findOwningProject, type ReadyProject } from "../commands/index.js";
import { readBuiltPdf } from "../preview/index.js";
import { disposeAll } from "../../disposables/index.js";

/** The open library as writing code needs it: a folder path and the logger of that library. */
export interface WritingSession {
  root: string;
  logger: ILogger;
}

/** Where the writing code gets its session; `require` offers the library setup when none is configured. */
export interface WritingHost {
  current: () => WritingSession | undefined;
  require: () => Promise<WritingSession | undefined>;
}

export class WritingProjects implements vscode.Disposable {
  private entries: readonly ProjectEntry[] = [];
  private reloadCount = 0;
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;

  /**
   * @param paths The path style of the project folders: the host's, which is not always "/".
   * @param fs The disk the project folders are on.
   * @param data Reads and writes the project folders and the project registry.
   */
  constructor(private readonly host: Pick<WritingHost, "current">, readonly paths: PathOps, readonly fs: LibraryFileSystem, readonly data: ProjectContentPort) {}

  /** What the core project readers run over; the logger is the open library's. */
  reads(logger: ILogger): ProjectReadContext {
    return { fs: this.fs, paths: this.paths, logger };
  }

  list(): readonly ProjectEntry[] {
    return this.entries;
  }

  async reload(): Promise<void> {
    const session = this.host.current();
    const ticket = ++this.reloadCount;
    let entries: readonly ProjectEntry[] = [];
    if (session) {
      try {
        entries = await this.data.listProjects(session.root);
      } catch (error) {
        await session.logger.error("writing/projects", error, { action: "list" });
      }
    }
    // A slower, older reload must not overwrite a newer result.
    if (ticket !== this.reloadCount) { return; }
    this.entries = entries;
    this.changeEmitter.fire();
  }

  dispose(): void {
    this.changeEmitter.dispose();
  }
}

async function openProjectMain(paths: PathOps, entry: ProjectEntry | undefined): Promise<void> {
  if (entry?.kind !== "ready") { return; }
  if (!entry.main) {
    await vscode.window.showInformationMessage(`Project "${entry.settings.id}" has no main file yet.`);
    return;
  }
  await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(paths.join(entry.folder, entry.main)));
}

const SAVED_FOLDER_KEY = "labshelf.writing.openProject";
const PROJECT_OPEN_KEY = "labshelf.writing.projectOpen";
const IN_PROJECT_KEY = "labshelf.writing.inProject";

/** The preview panels the session opens and disposes; `root` is relative to the project folder. */
interface SessionPreviews {
  show(project: ReadyProject, root: string, pdf: string, options: { beside: boolean }): void;
  close(projectFolder: string): void;
}

export interface ProjectSessionDeps {
  /** Remembers the open project across window reloads. */
  workspaceState: vscode.Memento;
  projects: Pick<WritingProjects, "list" | "paths" | "data" | "onDidChange" | "fs">;
  previews: SessionPreviews;
  host: Pick<WritingHost, "current">;
}

export class ProjectSession implements vscode.Disposable {
  private openFolder: string | undefined;
  private readonly subscriptions: vscode.Disposable[];
  private readonly changeEmitter = new vscode.EventEmitter<ReadyProject | undefined>();
  /** Fires with the project when one opens or is restored, and with `undefined` when it closes. */
  readonly onDidChange = this.changeEmitter.event;

  constructor(private readonly deps: ProjectSessionDeps) {
    this.subscriptions = [
      deps.projects.onDidChange(() => this.projectsChanged()),
      vscode.window.onDidChangeActiveTextEditor(() => this.updateInProject()),
    ];
  }

  /** The open project as the current project list has it. */
  get project(): ReadyProject | undefined {
    return this.deps.projects.list().find((entry): entry is ReadyProject => entry.kind === "ready" && entry.folder === this.openFolder);
  }

  async open(entry: ProjectEntry | undefined): Promise<void> {
    if (entry?.kind !== "ready") { return; }
    if (this.openFolder && this.openFolder !== entry.folder && !(await this.close())) { return; }
    this.markOpen(entry.folder);
    await this.deps.workspaceState.update(SAVED_FOLDER_KEY, entry.folder);
    await this.log("open", entry.folder);
    await openProjectMain(this.deps.projects.paths, entry);
    if (!entry.main) { return; }
    const pdf = await readBuiltPdf(this.deps.projects, entry, entry.main);
    if (pdf) {
      this.deps.previews.show(entry, entry.main, pdf, { beside: true });
    } else {
      // A build run by the command opens the preview when none is open.
      await vscode.commands.executeCommand(BUILD_COMMAND);
    }
  }

  /** Closes the project's source tabs and its preview; `false` when the user cancels closing a tab. */
  async close(): Promise<boolean> {
    const folder = this.openFolder;
    if (!folder) { return true; }
    const tabs = this.projectTabs(folder);
    if (tabs.length > 0 && !(await vscode.window.tabGroups.close(tabs))) {
      await this.log("close cancelled", folder);
      return false;
    }
    this.deps.previews.close(folder);
    this.markClosed();
    await this.deps.workspaceState.update(SAVED_FOLDER_KEY, undefined);
    await this.log("close", folder);
    return true;
  }

  dispose(): void {
    disposeAll(this.subscriptions);
    this.changeEmitter.dispose();
  }

  private projectTabs(folder: string): vscode.Tab[] {
    return vscode.window.tabGroups.all.flatMap((group) => group.tabs).filter((tab) =>
      tab.input instanceof vscode.TabInputText && findOwningProject(this.deps.projects, tab.input.uri.fsPath)?.folder === folder);
  }

  /** Restores the saved project after a reload (VS Code restores its tabs) and drops one that left the list. */
  private projectsChanged(): void {
    if (this.openFolder) {
      if (!this.project) { this.markClosed(); }
      return;
    }
    const saved = this.deps.workspaceState.get<string>(SAVED_FOLDER_KEY);
    if (!saved || !this.deps.projects.list().some((entry) => entry.kind === "ready" && entry.folder === saved)) { return; }
    this.markOpen(saved);
    void this.log("restore", saved);
  }

  private markOpen(folder: string): void {
    this.openFolder = folder;
    void vscode.commands.executeCommand("setContext", PROJECT_OPEN_KEY, true);
    this.updateInProject();
    this.changeEmitter.fire(this.project);
  }

  private markClosed(): void {
    this.openFolder = undefined;
    void vscode.commands.executeCommand("setContext", PROJECT_OPEN_KEY, false);
    this.updateInProject();
    this.changeEmitter.fire(undefined);
  }

  private updateInProject(): void {
    const document = vscode.window.activeTextEditor?.document;
    const inProject = !!this.openFolder && document?.uri.scheme === "file"
      && findOwningProject(this.deps.projects, document.uri.fsPath)?.folder === this.openFolder;
    void vscode.commands.executeCommand("setContext", IN_PROJECT_KEY, inProject);
  }

  private async log(action: string, folder: string): Promise<void> {
    await this.deps.host.current()?.logger.log("INFO", "writing/session", `Project ${action}`, { folder });
  }
}

export const OPEN_PROJECT_COMMAND = "labshelf.writing.openProject";
const CLOSE_PROJECT_COMMAND = "labshelf.writing.closeProject";

interface ProjectSessionCommandsDeps extends Omit<ProjectSessionDeps, "workspaceState"> {
  context: vscode.ExtensionContext;
}

export function registerProjectSession(deps: ProjectSessionCommandsDeps): ProjectSession {
  const { context, ...sessionDeps } = deps;
  const session = new ProjectSession({ ...sessionDeps, workspaceState: context.workspaceState });
  // Without an open library there is no logger; VS Code then reports a failure itself.
  const run = (command: string, action: () => Promise<void>): Promise<void> => {
    const logger = deps.host.current()?.logger;
    return logger ? runSafely(logger, command, action) : action();
  };
  context.subscriptions.push(
    session,
    vscode.commands.registerCommand(OPEN_PROJECT_COMMAND, (entry?: ProjectEntry) => run(OPEN_PROJECT_COMMAND, () => session.open(entry))),
    vscode.commands.registerCommand(CLOSE_PROJECT_COMMAND, () => run(CLOSE_PROJECT_COMMAND, async () => { await session.close(); })),
  );
  return session;
}

export function registerProjectWriteEvents(context: vscode.ExtensionContext, saves: ProjectWriteTracking, logger: ILogger): void {
  const fail = async (file: string, action: string, error: unknown): Promise<void> => {
    await logger.error('writing-merge', error, { file, action });
    void vscode.window.showErrorMessage(`Could not record project save for ${file}: ${formatError(error)}`);
  };
  context.subscriptions.push(
    vscode.workspace.onWillSaveTextDocument(event => {
      if (event.document.uri.scheme !== 'file') return;
      const file = event.document.uri.fsPath;
      event.waitUntil(saves.beforeSave(file, event.document.getText()).then(() => []).catch(async error => {
        await fail(file, 'record project save before write', error);
        throw error;
      }));
    }),
    vscode.workspace.onDidSaveTextDocument(document => {
      if (document.uri.scheme !== 'file') return;
      void saves.afterSave(document.uri.fsPath, document.getText()).catch(error => fail(document.uri.fsPath, 'record saved project text', error));
    }),
  );
}
