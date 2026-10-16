// Shows the writing projects as Projects view rows grouped by where they live, with counts that fill in after the list renders.
import * as vscode from "vscode";

import type { ILogger, ProjectEntry, ReadingList } from "@labshelf/core";
import type { ChecklistSignals } from "@labshelf/core/node";
import type { ArcIcon } from "../../ui/index.js";
import type { BuildOutcomes } from "../build/index.js";
import type { ReadyProject } from "../figures/index.js";
import type { WritingProjects } from "../session/index.js";
import { ProjectCounts } from "./projectCounts.js";
import {
  brokenItem, detailItem, detailLines, readyItem, sectionItem, type DetailNode, type ProjectNode, type ReadyEntry, type SectionNode,
} from "./projectRows.js";

const LOCATIONS: SectionNode["location"][] = ["library", "external"];

interface ProjectsTreeDeps {
  projects: Pick<WritingProjects, "list" | "onDidChange">;
  logger: ILogger;
  arcIcon: ArcIcon;
  readSignals: (project: ReadyEntry, logger: ILogger) => Promise<ChecklistSignals>;
  readingLists: { of(project: ReadyProject): Promise<ReadingList> };
  buildOutcomes: Pick<BuildOutcomes, "last" | "onDidChange">;
  watchFolder: (folder: string, onChange: () => void) => vscode.Disposable;
}

export class WritingTreeProvider implements vscode.TreeDataProvider<ProjectNode> {
  private readonly changeEmitter = new vscode.EventEmitter<ProjectNode | undefined>();
  readonly onDidChangeTreeData = this.changeEmitter.event;
  private readonly counts: ProjectCounts;
  private readonly subscriptions: vscode.Disposable[];

  constructor(private readonly deps: ProjectsTreeDeps) {
    this.counts = new ProjectCounts({ ...deps, onChanged: (entry) => this.changeEmitter.fire(entry) });
    this.subscriptions = [
      deps.projects.onDidChange(() => this.changeEmitter.fire(undefined)),
      deps.buildOutcomes.onDidChange((folder) => {
        const entry = deps.projects.list().find((candidate) => candidate.folder === folder);
        if (entry) { this.changeEmitter.fire(entry); }
      }),
    ];
  }

  getTreeItem(node: ProjectNode): vscode.TreeItem {
    if (node.kind === "section") { return sectionItem(node); }
    if (node.kind === "detail") { return detailItem(node); }
    if (node.kind === "broken") { return brokenItem(node, this.deps.arcIcon); }
    return readyItem(node, this.counts.counted(node), this.deps.buildOutcomes.last(node.folder), this.deps.arcIcon);
  }

  getChildren(node?: ProjectNode): ProjectNode[] | Promise<ProjectNode[]> {
    const entries = this.deps.projects.list();
    if (!node) { return LOCATIONS.filter((location) => entries.some((entry) => entry.location === location)).map((location) => ({ kind: "section", location })); }
    if (node.kind === "section") { return entries.filter((entry) => entry.location === node.location); }
    return node.kind === "ready" ? this.details(node) : [];
  }

  dispose(): void {
    for (const subscription of this.subscriptions) { subscription.dispose(); }
    this.counts.dispose();
    this.changeEmitter.dispose();
  }

  private async details(entry: ReadyEntry): Promise<DetailNode[]> {
    const [counted, reading] = await Promise.all([this.counts.load(entry), this.deps.readingLists.of(entry)]);
    return detailLines(entry, counted, this.deps.buildOutcomes.last(entry.folder), reading).map((label) => ({ kind: "detail", label }));
  }
}
