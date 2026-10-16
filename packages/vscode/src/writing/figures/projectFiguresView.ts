// Shows the open project's figures as the Figures view and publishes their count as the view description and the hasFigures context key.
import * as vscode from "vscode";

import type { PathOps } from "@labshelf/core";
import type { ProjectSession } from "../session/index.js";
import type { FigureNode } from "./figureNode.js";
import { figureTreeItem } from "./figureTreeItem.js";
import type { ProjectFigures } from "./projectFigures.js";

const HAS_FIGURES_KEY = "labshelf.writing.hasFigures";

interface ProjectFiguresViewDeps {
  session: Pick<ProjectSession, "project" | "onDidChange">;
  figures: Pick<ProjectFigures, "children" | "onDidChange">;
  paths: PathOps;
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
    return figureTreeItem(node, this.deps.paths);
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
    for (const subscription of this.subscriptions) { subscription.dispose(); }
    this.changeEmitter.dispose();
  }
}
