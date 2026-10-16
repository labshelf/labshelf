// Shows each writing project as a Writing view row, with its main file and, for problem projects, the reason, and the figures and reading list of a project below it.
import * as vscode from "vscode";

import type { ProjectEntry } from "@labshelf/core";
import { figureTreeItem, type FigureNode, type ProjectFigures, type ReadyProject } from "./figures/index.js";
import type { WritingProjects } from "./projectStore.js";
import { readingListChildren, readingTreeItem, type ProjectReadingLists, type ReadingNode } from "./readingList/index.js";

export type WritingNode = ProjectEntry | FigureNode | ReadingNode;

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
  item.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
  item.description = entry.main ?? "no main file";
  if (entry.location === "external") { item.tooltip = entry.folder; }
  item.command = { command: OPEN_MAIN_COMMAND, title: "Open Main Document", arguments: [entry] };
  return item;
}

export class WritingTreeProvider implements vscode.TreeDataProvider<WritingNode> {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changeEmitter.event;
  private readonly subscriptions: vscode.Disposable[];

  constructor(
    private readonly projects: WritingProjects,
    private readonly figures: Pick<ProjectFigures, "children" | "onDidChange">,
    private readonly readingLists: Pick<ProjectReadingLists, "of" | "onDidChange">,
  ) {
    const refresh = (): void => this.changeEmitter.fire();
    this.subscriptions = [projects.onDidChange(refresh), figures.onDidChange(refresh), readingLists.onDidChange(refresh)];
  }

  getTreeItem(node: WritingNode): vscode.TreeItem {
    if (node.kind === "figure") { return figureTreeItem(node, this.projects.paths); }
    return node.kind === "ready" || node.kind === "broken" ? projectTreeItem(node) : readingTreeItem(node);
  }

  getChildren(parent?: WritingNode): WritingNode[] | Promise<WritingNode[]> {
    if (!parent) { return [...this.projects.list()]; }
    if (parent.kind === "readingList") { return readingListChildren(parent); }
    return parent.kind === "ready" ? this.projectChildren(parent) : [];
  }

  private async projectChildren(project: ReadyProject): Promise<WritingNode[]> {
    const [figures, list] = await Promise.all([this.figures.children(project), this.readingLists.of(project)]);
    return [...figures, { kind: "readingList", project, list }];
  }

  dispose(): void {
    for (const subscription of this.subscriptions) { subscription.dispose(); }
    this.changeEmitter.dispose();
  }
}
