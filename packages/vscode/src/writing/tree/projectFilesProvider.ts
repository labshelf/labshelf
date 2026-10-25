// Shows the open project's folder as read from disk, folders first, as the rows of the Files view.
import * as vscode from "vscode";

import { createProjectFileRow, listVisibleEntries, type ILogger } from "@labshelf/core";
import type { ReadyProject } from "../buildRootDocument.js";
import type { ProjectSession, WritingProjects } from "../session/index.js";

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

export function projectFolderUri(project: ReadyProject): vscode.Uri {
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
    const folder = parent?.uri ?? projectFolderUri(project);
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
    const path = project ? relativePath(projectFolderUri(project), node.uri) : node.uri.path;
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
    this.subscriptions.forEach((subscription) => subscription.dispose());
    this.changeEmitter.dispose();
  }
}
