// The Files view of the open project (rows, watcher, commands) and the registration of the project's views: Figures, Files, Outline and Checklist.
import * as vscode from "vscode";

import { createDebouncer, createProjectFileRow, formatError, listVisibleEntries, type ILogger, type LibraryFileSystem, type ReadingStatus } from "@labshelf/core";
import type { ArcIcon } from "../../ui/index.js";
import type { BuildOutcomes } from "../build/index.js";
import type { ProjectReadingLists } from "../citations/index.js";
import type { ReadyProject } from "../commands/index.js";
import { ProjectFiguresView, type ProjectFigures } from "../figures/index.js";
import type { BuildPreviews } from "../preview/index.js";
import { registerChecklistView } from "./checklist.js";
import { createSignalsReader } from "./checklistSignals.js";
import { ProjectTreeMirror, type ProjectTreeSpec } from "./mirror.js";
import { OutlineTreeProvider, REVEAL_OUTLINE_COMMAND, registerTypstOutline, showOutline } from "./outline.js";
import type { ProjectSession, WritingProjects } from "./session.js";
import { SidebarProjectsSource } from "./sidebar.js";
import { disposeAll } from "../../disposables/index.js";

/** A file or folder below the open project's folder. */
export interface ProjectFileNode {
  uri: vscode.Uri;
  type: vscode.FileType;
}

interface ProjectFilesDeps {
  session: Pick<ProjectSession, "project" | "onDidChange">;
  /** Fires when project settings change, which can move the main file. */
  projects: Pick<WritingProjects, "onDidChange">;
  logger: ILogger;
}

const isFolder = (type: vscode.FileType): boolean => (type & vscode.FileType.Directory) !== 0;

export function createProjectFolderUri(project: ReadyProject): vscode.Uri {
  return vscode.Uri.file(project.folder);
}

const relativePath = (root: vscode.Uri, uri: vscode.Uri): string => uri.path.slice(root.path.length).replace(/^\/+/, "");

export class ProjectFilesProvider implements vscode.TreeDataProvider<ProjectFileNode>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changeEmitter.event;
  private readonly subscriptions: vscode.Disposable[];

  constructor(private readonly deps: ProjectFilesDeps) {
    this.subscriptions = [deps.session.onDidChange(() => this.refresh()), deps.projects.onDidChange(() => this.refresh())];
  }

  refresh(): void {
    this.changeEmitter.fire();
  }

  async getChildren(parent?: ProjectFileNode): Promise<ProjectFileNode[]> {
    const project = this.deps.session.project;
    if (!project) { return []; }
    const folder = parent?.uri ?? createProjectFolderUri(project);
    try {
      const entries = await vscode.workspace.fs.readDirectory(folder);
      return listVisibleEntries(entries.map(([name, type]) => ({ name, type, folder: isFolder(type) })))
        .map(({ name, type }) => ({ uri: vscode.Uri.joinPath(folder, name), type }));
    } catch (error) {
      await this.deps.logger.error("writing/tree", error, { action: "read-folder", uri: folder.fsPath });
      return [];
    }
  }

  getTreeItem(node: ProjectFileNode): vscode.TreeItem {
    const project = this.deps.session.project;
    const folder = isFolder(node.type);
    const path = project ? relativePath(createProjectFolderUri(project), node.uri) : node.uri.path;
    const { kind, node: row } = createProjectFileRow(path, folder, { format: project?.settings.format, main: project?.main });
    const item = new vscode.TreeItem(row.label, folder ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
    item.resourceUri = node.uri;
    item.id = node.uri.toString();
    item.contextValue = { folder: "labshelfProjectFolder", file: "labshelfProjectFile", source: "labshelfProjectSource" }[kind];
    if (folder) { return item; }
    item.command = { command: "vscode.open", title: "Open File", arguments: [node.uri] };
    if (row.description) { item.description = row.description; }
    return item;
  }

  dispose(): void {
    disposeAll(this.subscriptions);
    this.changeEmitter.dispose();
  }
}

// Coalesces a burst of events (a checkout, a build of figures) into one refresh.
const DEBOUNCE_MS = 200;

/** Keeps one watcher on `glob` under the open project's folder and replaces it when the session opens another project. */
export function watchProjectFiles(session: Pick<ProjectSession, "project" | "onDidChange">, refresh: () => void, glob = "**"): vscode.Disposable {
  let watcher: vscode.FileSystemWatcher | undefined;
  const refreshSoon = createDebouncer(refresh, DEBOUNCE_MS);
  const schedule = (): void => refreshSoon.call();
  const watch = (project: ReadyProject | undefined): void => {
    watcher?.dispose();
    watcher = undefined;
    if (!project) { return; }
    watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(createProjectFolderUri(project), glob));
    // Content changes do not change the tree, so only creations and deletions refresh it.
    watcher.onDidCreate(schedule);
    watcher.onDidDelete(schedule);
  };
  watch(session.project);
  const subscription = session.onDidChange(watch);
  return new vscode.Disposable(() => {
    subscription.dispose();
    refreshSoon.cancel();
    watcher?.dispose();
  });
}

const MODULE = "writing/tree";

interface ProjectFileCommandsDeps {
  context: vscode.ExtensionContext;
  session: Pick<ProjectSession, "project">;
  logger: ILogger;
  fs: Pick<LibraryFileSystem, "writeFile">;
}

const uriBaseName = (uri: vscode.Uri): string => uri.path.split("/").pop() ?? uri.path;

/** Rejects names that would leave the target folder or name nothing. */
function invalidFileName(value: string): string | undefined {
  const name = value.trim();
  if (!name) { return "Enter a name."; }
  if (/[\\/]/.test(name)) { return "A name cannot contain / or \\."; }
  if (name === "." || name === "..") { return "Enter a file or folder name."; }
  return undefined;
}

async function askName(prompt: string, value?: string): Promise<string | undefined> {
  // Selects the name without its extension, as the Explorer does.
  const dot = value?.lastIndexOf(".") ?? -1;
  const name = await vscode.window.showInputBox({
    prompt, validateInput: invalidFileName, ...(value ? { value, valueSelection: [0, dot > 0 ? dot : value.length] as [number, number] } : {}),
  });
  return name === undefined || invalidFileName(name) ? undefined : name.trim();
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

/** Runs one file operation; logs and shows its failure. `true` when it succeeded. */
async function run(logger: ILogger, action: string, uri: vscode.Uri, operation: () => Thenable<void>): Promise<boolean> {
  try {
    await operation();
    await logger.log("INFO", MODULE, `Project file ${action}`, { uri: uri.fsPath });
    return true;
  } catch (error) {
    await logger.error(MODULE, error, { action, uri: uri.fsPath });
    void vscode.window.showErrorMessage(`Could not ${action} ${uriBaseName(uri)}: ${formatError(error)}`);
    return false;
  }
}

/** Asks for a name inside the clicked folder, or the project folder when called from the view title. */
async function create(deps: ProjectFileCommandsDeps, kind: "file" | "folder", target?: ProjectFileNode): Promise<void> {
  const project = deps.session.project;
  if (!project) { return; }
  const name = await askName(kind === "file" ? "New file name" : "New folder name");
  if (!name) { return; }
  const uri = vscode.Uri.joinPath(target?.uri ?? createProjectFolderUri(project), name);
  if (await exists(uri)) {
    void vscode.window.showErrorMessage(`${name} already exists.`);
    return;
  }
  if (kind === "folder") {
    await run(deps.logger, "create folder", uri, () => vscode.workspace.fs.createDirectory(uri));
  } else if (await run(deps.logger, "create file", uri, () => deps.fs.writeFile(uri.fsPath, new Uint8Array()))) {
    await vscode.commands.executeCommand("vscode.open", uri);
  }
}

async function rename(deps: ProjectFileCommandsDeps, target: ProjectFileNode): Promise<void> {
  const name = await askName("New name", uriBaseName(target.uri));
  if (!name || name === uriBaseName(target.uri)) { return; }
  const renamed = vscode.Uri.joinPath(target.uri, "..", name);
  await run(deps.logger, "rename", target.uri, () => vscode.workspace.fs.rename(target.uri, renamed, { overwrite: false }));
}

async function remove(deps: ProjectFileCommandsDeps, target: ProjectFileNode): Promise<void> {
  const choice = await vscode.window.showWarningMessage(
    `Delete ${uriBaseName(target.uri)}?`, { modal: true, detail: "It moves to the trash." }, "Delete",
  );
  if (choice !== "Delete") { return; }
  await run(deps.logger, "delete", target.uri, () => vscode.workspace.fs.delete(target.uri, { recursive: true, useTrash: true }));
}

export function registerProjectFileCommands(deps: ProjectFileCommandsDeps): void {
  deps.context.subscriptions.push(
    vscode.commands.registerCommand("labshelf.writing.newFile", (target?: ProjectFileNode) => create(deps, "file", target)),
    vscode.commands.registerCommand("labshelf.writing.newFolder", (target?: ProjectFileNode) => create(deps, "folder", target)),
    vscode.commands.registerCommand("labshelf.writing.renameFile", (target: ProjectFileNode) => rename(deps, target)),
    vscode.commands.registerCommand("labshelf.writing.deleteFile", (target: ProjectFileNode) => remove(deps, target)),
  );
}

/** Reports every create, change or delete under a project folder. */
function watchFolder(folder: string, onChange: () => void): vscode.Disposable {
  const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, "**/*"));
  return vscode.Disposable.from(watcher, watcher.onDidCreate(onChange), watcher.onDidChange(onChange), watcher.onDidDelete(onChange));
}

interface ProjectViewsDeps {
  context: vscode.ExtensionContext;
  projects: WritingProjects;
  figures: ProjectFigures;
  session: ProjectSession;
  logger: ILogger;
  arcIcon: ArcIcon;
  readingLists: ProjectReadingLists;
  outcomes: BuildOutcomes;
  previews: Pick<BuildPreviews, "onDidCountBodyPages">;
  onDidChangeBacklinks: vscode.Event<void>;
  setStatus: (paperIds: string[], status: ReadingStatus) => Promise<string[]>;
}

/** What the library sidebar view renders in its Projects section. */
export interface ProjectViewsResult {
  projectsSource: SidebarProjectsSource;
  projectTrees: ProjectTreeMirror;
}

const RENAME = { label: "Rename…", action: "rename", command: "labshelf.writing.renameFile" };
const DELETE = { label: "Delete", action: "delete", danger: true, command: "labshelf.writing.deleteFile" };

function filesSpec(provider: ProjectFilesProvider): ProjectTreeSpec<ProjectFileNode> {
  const run = (id: string) => (): unknown => vscode.commands.executeCommand(id);
  return {
    view: "files", title: "Files", provider, empty: "No files.",
    actions: [
      { action: "newFile", label: "New file", icon: "new-file", run: run("labshelf.writing.newFile") },
      { action: "newFolder", label: "New folder", icon: "new-folder", run: run("labshelf.writing.newFolder") },
    ],
    menus: {
      labshelfProjectFolder: [
        { label: "New File…", action: "newFile", command: "labshelf.writing.newFile" },
        { label: "New Folder…", action: "newFolder", command: "labshelf.writing.newFolder" },
        RENAME, DELETE,
      ],
      labshelfProjectFile: [RENAME, DELETE],
      labshelfProjectSource: [{ label: "Set as Main File", action: "setMain", command: "labshelf.writing.setMain" }, RENAME, DELETE],
    },
  };
}

export function registerProjectViews(deps: ProjectViewsDeps): ProjectViewsResult {
  const { context, projects, figures, session, logger, arcIcon, readingLists, outcomes } = deps;
  const projectsSource = new SidebarProjectsSource({
    projects, logger, readingLists, buildOutcomes: outcomes, readSignals: createSignalsReader(projects), watchFolder,
  });
  const files = new ProjectFilesProvider({ session, projects, logger });
  const outline = new OutlineTreeProvider(logger);
  const figuresView = new ProjectFiguresView({ session, figures, paths: projects.paths, arcIcon });
  const figuresTree = vscode.window.createTreeView("labshelf.writing.figures", { treeDataProvider: figuresView });
  figuresView.attach(figuresTree);
  context.subscriptions.push(
    projectsSource,
    files,
    figuresView,
    watchProjectFiles(session, () => files.refresh()),
    figuresTree,
    outline.follow(),
    vscode.commands.registerCommand(REVEAL_OUTLINE_COMMAND, showOutline),
    registerTypstOutline(),
  );
  registerProjectFileCommands({ context, session, logger, fs: projects.fs });
  const checklist = registerChecklistView({ context, session, projects, previews: deps.previews, readingLists, onDidChangeBacklinks: deps.onDidChangeBacklinks, setStatus: deps.setStatus, logger });
  const outlineSpec: ProjectTreeSpec<unknown> = {
    view: "outline", title: "Outline", provider: outline, empty: "Open a source file to see its outline.", actions: [], menus: {},
  };
  const projectTrees = new ProjectTreeMirror({ session, logger, specs: [filesSpec(files), outlineSpec, checklist] as Array<ProjectTreeSpec<unknown>> });
  context.subscriptions.push(projectTrees);
  return { projectsSource, projectTrees };
}
