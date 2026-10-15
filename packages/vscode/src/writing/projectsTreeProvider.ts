// Shows each writing project as a Writing view row, with its main file and, for problem projects, the reason.
import * as vscode from "vscode";

import type { ProjectEntry } from "@labshelf/core/node";
import type { WritingProjects } from "./projectStore.js";

export const OPEN_MAIN_COMMAND = "labshelf.writing.openMain";

function contextValue(entry: ProjectEntry): string {
  const external = entry.location === "external" ? "External" : "";
  return entry.kind === "broken" ? `labshelfProjectBroken${external}` : `labshelfProject${external}`;
}

export function projectTreeItem(entry: ProjectEntry): vscode.TreeItem {
  const item = new vscode.TreeItem(
    entry.kind === "ready" ? entry.settings.id : entry.folder.split(/[\\/]/).pop() ?? entry.folder,
    vscode.TreeItemCollapsibleState.None,
  );
  item.id = entry.folder;
  item.contextValue = contextValue(entry);
  if (entry.kind === "broken") {
    item.iconPath = new vscode.ThemeIcon("warning");
    item.description = entry.reason;
    item.tooltip = `${entry.folder}\n${entry.reason}`;
    return item;
  }
  item.iconPath = new vscode.ThemeIcon("book");
  item.description = entry.main ?? "no main file";
  if (entry.location === "external") { item.tooltip = entry.folder; }
  item.command = { command: OPEN_MAIN_COMMAND, title: "Open Main Document", arguments: [entry] };
  return item;
}

export class WritingTreeProvider implements vscode.TreeDataProvider<ProjectEntry> {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changeEmitter.event;
  private readonly subscription: vscode.Disposable;

  constructor(private readonly projects: WritingProjects) {
    this.subscription = projects.onDidChange(() => this.changeEmitter.fire());
  }

  getTreeItem(entry: ProjectEntry): vscode.TreeItem {
    return projectTreeItem(entry);
  }

  getChildren(parent?: ProjectEntry): ProjectEntry[] {
    return parent ? [] : [...this.projects.list()];
  }

  dispose(): void {
    this.subscription.dispose();
    this.changeEmitter.dispose();
  }
}
