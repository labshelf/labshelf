// Shows each writing project as a Writing view row, with its main file and, for problem projects, the reason, and the figures of a project below it.
import * as vscode from "vscode";

import type { ProjectEntry } from "@labshelf/core/node";
import { figureTreeItem, type FigureNode, type ProjectFigures } from "./figures/index.js";
import type { WritingProjects } from "./projectStore.js";

export type WritingNode = ProjectEntry | FigureNode;

const OPEN_MAIN_COMMAND = "labshelf.writing.openMain";

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
  if (Object.keys(entry.settings.figures ?? {}).length > 0) { item.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed; }
  item.description = entry.main ?? "no main file";
  if (entry.location === "external") { item.tooltip = entry.folder; }
  item.command = { command: OPEN_MAIN_COMMAND, title: "Open Main Document", arguments: [entry] };
  return item;
}

export class WritingTreeProvider implements vscode.TreeDataProvider<WritingNode> {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changeEmitter.event;
  private readonly subscriptions: vscode.Disposable[];

  constructor(private readonly projects: WritingProjects, private readonly figures: Pick<ProjectFigures, "children" | "onDidChange">) {
    this.subscriptions = [projects.onDidChange(() => this.changeEmitter.fire()), figures.onDidChange(() => this.changeEmitter.fire())];
  }

  getTreeItem(node: WritingNode): vscode.TreeItem {
    return node.kind === "figure" ? figureTreeItem(node) : projectTreeItem(node);
  }

  getChildren(parent?: WritingNode): WritingNode[] | Promise<WritingNode[]> {
    if (!parent) { return [...this.projects.list()]; }
    return parent.kind === "ready" ? this.figures.children(parent) : [];
  }

  dispose(): void {
    for (const subscription of this.subscriptions) { subscription.dispose(); }
    this.changeEmitter.dispose();
  }
}
