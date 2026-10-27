// Shows the open project's figures as the Figures view and publishes their count as the view description and the hasFigures context key; shows a figure as a row, stale or missing marked, the newer inputs and the command in the tooltip, opened on click.
import * as vscode from "vscode";

import type { ArcKind, PathOps } from "@labshelf/core";
import type { ArcIcon } from "../../ui/index.js";
import type { ProjectSession } from "../projects/index.js";
import type { FigureNode, ProjectFigures } from "./projectFigures.js";
import { disposeAll } from "../../disposables/index.js";

const STALE_FIGURE_CONTEXT = "labshelfFigureStale";
const FRESH_FIGURE_CONTEXT = "labshelfFigure";

const TONE: Record<FigureNode["state"]["status"], ArcKind> = { stale: "warn", missing: "err", fresh: "ok" };

function tooltip(node: FigureNode): string {
  const { state } = node;
  const lines = [node.path];
  if (state.status === "fresh") { lines.push("Fresh: the figure is newer than its inputs."); }
  if (state.status === "missing") { lines.push("Missing: the figure file does not exist."); }
  if (state.status === "stale") { lines.push("Stale: newer inputs", ...state.newerInputs.map((input) => `  ${input}`)); }
  if (state.missingInputs.length > 0) { lines.push("Inputs not found", ...state.missingInputs.map((input) => `  ${input}`)); }
  lines.push(`Command: ${node.recipe.run}`);
  return lines.join("\n");
}

export function createFigureTreeItem(node: FigureNode, paths: PathOps, arcIcon: ArcIcon): vscode.TreeItem {
  const { status } = node.state;
  const item = new vscode.TreeItem(node.path, vscode.TreeItemCollapsibleState.None);
  item.id = `${node.project.folder}#figure:${node.path}`;
  item.contextValue = status === "fresh" ? FRESH_FIGURE_CONTEXT : STALE_FIGURE_CONTEXT;
  item.iconPath = arcIcon(TONE[status], "full");
  if (status !== "fresh") { item.description = status; }
  item.tooltip = tooltip(node);
  if (status !== "missing") {
    const file = vscode.Uri.file(paths.join(node.project.folder, node.path));
    item.command = { command: "vscode.open", title: "Open Figure", arguments: [file] };
  }
  return item;
}

const HAS_FIGURES_KEY = "labshelf.writing.hasFigures";

interface ProjectFiguresViewDeps {
  session: Pick<ProjectSession, "project" | "onDidChange">;
  figures: Pick<ProjectFigures, "children" | "onDidChange">;
  paths: PathOps;
  arcIcon: ArcIcon;
}

export class ProjectFiguresView implements vscode.TreeDataProvider<FigureNode>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changeEmitter.event;
  private readonly subscriptions: vscode.Disposable[];
  private nodes: FigureNode[] = [];
  private loads = 0;
  private view: Pick<vscode.TreeView<FigureNode>, "description"> | undefined;

  constructor(private readonly deps: ProjectFiguresViewDeps) {
    this.subscriptions = [deps.session.onDidChange(() => void this.reload()), deps.figures.onDidChange(() => void this.reload())];
    void this.reload();
  }

  /** Binds the tree view whose description shows the figure count. */
  attach(view: Pick<vscode.TreeView<FigureNode>, "description">): void {
    this.view = view;
    this.publish();
  }

  getTreeItem(node: FigureNode): vscode.TreeItem {
    return createFigureTreeItem(node, this.deps.paths, this.deps.arcIcon);
  }

  getChildren(parent?: FigureNode): FigureNode[] {
    return parent ? [] : this.nodes;
  }

  // INVARIANT: the context key is set from here, not from getChildren, because a hidden view is never asked for children.
  private async reload(): Promise<void> {
    const load = ++this.loads;
    const project = this.deps.session.project;
    const nodes = project ? await this.deps.figures.children(project) : [];
    if (load !== this.loads) { return; }
    this.nodes = nodes;
    this.publish();
    this.changeEmitter.fire();
  }

  private publish(): void {
    if (this.view) { this.view.description = this.nodes.length > 0 ? String(this.nodes.length) : ""; }
    void vscode.commands.executeCommand("setContext", HAS_FIGURES_KEY, this.nodes.length > 0);
  }

  dispose(): void {
    disposeAll(this.subscriptions);
    this.changeEmitter.dispose();
  }
}
