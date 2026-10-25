// Opens and closes the window's writing project as a unit: its main document, its preview, its tabs and its context keys.
import * as vscode from "vscode";

import type { ProjectEntry, PathOps } from "@labshelf/core";
import { BUILD_COMMAND } from "../build/index.js";
import { owningProject, type ReadyProject } from "../buildRootDocument.js";
import { builtPdf } from "../preview/index.js";
import type { WritingHost, WritingProjects } from "./projectStore.js";

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
    const pdf = await builtPdf(this.deps.projects, entry, entry.main);
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
    this.subscriptions.forEach((subscription) => subscription.dispose());
    this.changeEmitter.dispose();
  }

  private projectTabs(folder: string): vscode.Tab[] {
    return vscode.window.tabGroups.all.flatMap((group) => group.tabs).filter((tab) =>
      tab.input instanceof vscode.TabInputText && owningProject(this.deps.projects, tab.input.uri.fsPath)?.folder === folder);
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
      && owningProject(this.deps.projects, document.uri.fsPath)?.folder === this.openFolder;
    void vscode.commands.executeCommand("setContext", IN_PROJECT_KEY, inProject);
  }

  private async log(action: string, folder: string): Promise<void> {
    await this.deps.host.current()?.logger.log("INFO", "writing/session", `Project ${action}`, { folder });
  }
}
