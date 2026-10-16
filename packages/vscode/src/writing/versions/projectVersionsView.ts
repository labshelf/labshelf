// Shows the open project's versions, newest first, as the Versions view with their count as description and the hasVersions context key.
import * as vscode from "vscode";

import type { ProjectVersion } from "@labshelf/core";
import type { ReadyProject } from "../mainDocument.js";
import type { ProjectSession } from "../session/index.js";
import { versionTreeItem } from "./versionTreeItem.js";

const HAS_VERSIONS_KEY = "labshelf.writing.hasVersions";

export interface VersionRow {
  project: ReadyProject;
  version: ProjectVersion;
  /** False when the version's `paper.pdf` is gone from disk. */
  hasPdf: boolean;
}

interface ProjectVersionsViewDeps {
  session: Pick<ProjectSession, "project" | "onDidChange">;
  listVersions: (folder: string) => Promise<ProjectVersion[]>;
  pdfExists: (path: string) => Promise<boolean>;
}

export class ProjectVersionsView implements vscode.TreeDataProvider<VersionRow>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changeEmitter.event;
  private readonly subscription: vscode.Disposable;
  private rows: VersionRow[] = [];
  private loads = 0;
  private view: Pick<vscode.TreeView<VersionRow>, "description"> | undefined;

  constructor(private readonly deps: ProjectVersionsViewDeps) {
    this.subscription = deps.session.onDidChange(() => void this.refresh());
    void this.refresh();
  }

  /** Binds the tree view whose description shows the version count. */
  attach(view: Pick<vscode.TreeView<VersionRow>, "description">): void {
    this.view = view;
    this.publish();
  }

  getTreeItem(row: VersionRow): vscode.TreeItem {
    return versionTreeItem(row);
  }

  getChildren(parent?: VersionRow): VersionRow[] {
    return parent ? [] : this.rows;
  }

  // INVARIANT: the context key is set from here, not from getChildren, because a hidden view is never asked for children.
  async refresh(): Promise<void> {
    const load = ++this.loads;
    const project = this.deps.session.project;
    const rows = project ? await this.load(project) : [];
    if (load !== this.loads) { return; }
    this.rows = rows;
    this.publish();
    this.changeEmitter.fire();
  }

  private async load(project: ReadyProject): Promise<VersionRow[]> {
    const versions = [...await this.deps.listVersions(project.folder)].sort((a, b) => Date.parse(b.created) - Date.parse(a.created));
    return Promise.all(versions.map(async (version) => ({ project, version, hasPdf: await this.deps.pdfExists(version.pdfPath) })));
  }

  private publish(): void {
    if (this.view) { this.view.description = this.rows.length > 0 ? String(this.rows.length) : ""; }
    void vscode.commands.executeCommand("setContext", HAS_VERSIONS_KEY, this.rows.length > 0);
  }

  dispose(): void {
    this.subscription.dispose();
    this.changeEmitter.dispose();
  }
}
