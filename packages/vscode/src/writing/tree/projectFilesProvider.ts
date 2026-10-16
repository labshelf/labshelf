// Shows the open project's folder as read from disk, folders first, as the rows of the Files view.
import * as vscode from "vscode";

import type { ILogger } from "@labshelf/core";
import type { ReadyProject } from "../mainDocument.js";
import type { ProjectSession, WritingProjects } from "../session/index.js";

/** A file or folder below the open project's folder. */
export interface ProjectFileNode {
  uri: vscode.Uri;
  type: vscode.FileType;
}

// Build output lives in the cache, outside the project, so only these folders are not the user's sources.
const HIDDEN_NAMES = new Set([".git", ".labshelf"]);

interface ProjectFilesDeps {
  session: Pick<ProjectSession, "project" | "onDidChange">;
  /** Fires when project settings change, which can move the main file. */
  projects: Pick<WritingProjects, "onDidChange">;
  logger: ILogger;
}

const isFolder = (type: vscode.FileType): boolean => (type & vscode.FileType.Directory) !== 0;

export function projectFolderUri(project: ReadyProject): vscode.Uri {
  return vscode.Uri.file(project.folder);
}

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
    const folder = parent?.uri ?? projectFolderUri(project);
    try {
      const entries = await vscode.workspace.fs.readDirectory(folder);
      return entries
        .filter(([name]) => !HIDDEN_NAMES.has(name))
        .sort(([nameA, typeA], [nameB, typeB]) => Number(isFolder(typeB)) - Number(isFolder(typeA)) || nameA.localeCompare(nameB))
        .map(([name, type]) => ({ uri: vscode.Uri.joinPath(folder, name), type }));
    } catch (error) {
      await this.deps.logger.error("writing/tree", error, { action: "read-folder", uri: folder.fsPath });
      return [];
    }
  }

  getTreeItem(node: ProjectFileNode): vscode.TreeItem {
    const folder = isFolder(node.type);
    const name = node.uri.path.split("/").pop() ?? node.uri.path;
    const item = new vscode.TreeItem(name, folder ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
    item.resourceUri = node.uri;
    item.id = node.uri.toString();
    item.contextValue = folder ? "labshelfProjectFolder" : "labshelfProjectFile";
    if (folder) { return item; }
    item.command = { command: "vscode.open", title: "Open File", arguments: [node.uri] };
    if (this.isMain(node.uri)) { item.description = "main"; }
    return item;
  }

  private isMain(uri: vscode.Uri): boolean {
    const project = this.deps.session.project;
    return !!project?.main && vscode.Uri.joinPath(projectFolderUri(project), project.main).fsPath === uri.fsPath;
  }

  dispose(): void {
    this.subscriptions.forEach((subscription) => subscription.dispose());
    this.changeEmitter.dispose();
  }
}
