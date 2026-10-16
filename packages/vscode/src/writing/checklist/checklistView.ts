// Shows the open project's checklist as the Checklist view and publishes its open count, grouping and visibility.
import * as vscode from "vscode";

import {
  addManualItem, buildChecklist, citeSections, nextStatus, removeManualItem, sectionPlacer, setManualItemDone,
  type ChecklistDocument, type ChecklistGrouping, type ILogger, type PaperStatus, type ReadingItem,
} from "@labshelf/core";
import type { ArcIcon } from "../../ui/index.js";
import type { ReadyProject } from "../figures/index.js";
import type { ProjectReadingLists } from "../readingList/index.js";
import { ChecklistMemory } from "./checklistMemory.js";
import { checklistNodes, type ChecklistNode } from "./checklistNodes.js";
import { checklistTreeItem } from "./checklistTreeItem.js";
import type { OpenProjectSignals } from "./openProjectSignals.js";

const MODULE = "writing/checklist";
const HAS_CHECKLIST_KEY = "labshelf.writing.hasChecklist";
const BY_SECTION_KEY = "labshelf.writing.checklistBySection";

export interface ChecklistViewDeps {
  signals: Pick<OpenProjectSignals, "current" | "onDidChange" | "refresh">;
  reading: Pick<ProjectReadingLists, "of"> & { onDidChange: vscode.Event<void> };
  memory: vscode.Memento;
  setStatus: (paperIds: string[], status: PaperStatus) => Promise<string[]>;
  updateChecklist: (folder: string, edit: (doc: ChecklistDocument) => ChecklistDocument) => Promise<void>;
  logger: ILogger;
  arcIcon: ArcIcon;
  newId: () => string;
  now: () => Date;
}

interface ReadingCache { folder: string; items: ReadingItem[]; paperIds: Map<string, string> }

export class ChecklistView implements vscode.TreeDataProvider<ChecklistNode>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changeEmitter.event;
  private readonly subscriptions: vscode.Disposable[];
  private readonly memory: ChecklistMemory;
  private nodes: ChecklistNode[] = [];
  private rendered: { project: ReadyProject; grouping: ChecklistGrouping } | undefined;
  private reading: ReadingCache | undefined;
  /** Bumped on every reading-list load so a load that finishes late is dropped. */
  private readingLoads = 0;
  private view: Pick<vscode.TreeView<ChecklistNode>, "description"> | undefined;

  constructor(private readonly deps: ChecklistViewDeps) {
    this.memory = new ChecklistMemory(deps.memory);
    this.subscriptions = [deps.signals.onDidChange(() => this.onSignals()), deps.reading.onDidChange(() => void this.loadReading())];
    this.onSignals();
  }

  /** Binds the tree view whose description shows the open count. */
  attach(view: Pick<vscode.TreeView<ChecklistNode>, "description">): void {
    this.view = view;
    this.render();
  }

  getTreeItem(node: ChecklistNode): vscode.TreeItem {
    const { project, grouping } = this.rendered!;
    const isExpanded = (groupId: string) => this.memory.isExpanded(project.folder, grouping, groupId);
    return checklistTreeItem(node, { project, grouping, isExpanded, arcIcon: this.deps.arcIcon });
  }

  getChildren(parent?: ChecklistNode): ChecklistNode[] {
    if (!parent) { return this.nodes; }
    return parent.type === "group" || parent.type === "read" ? parent.children : [];
  }

  onDidExpand(node: ChecklistNode): Promise<void> { return this.rememberExpanded(node, true); }

  onDidCollapse(node: ChecklistNode): Promise<void> { return this.rememberExpanded(node, false); }

  async toggleGrouping(): Promise<void> {
    const project = this.deps.signals.current?.project;
    if (!project) { return; }
    const grouping = this.memory.grouping(project.folder) === "kind" ? "section" : "kind";
    await this.memory.setGrouping(project.folder, grouping);
    this.render();
  }

  async addItem(): Promise<void> {
    if (!this.deps.signals.current) { await this.deps.signals.refresh(); }
    const project = this.deps.signals.current?.project;
    if (!project) { return; }
    const text = (await vscode.window.showInputBox({ prompt: "New checklist item", ignoreFocusOut: true }))?.trim();
    if (!text) { return; }
    const id = this.deps.newId();
    await this.editChecklist(project, "add", (doc) => addManualItem(doc, { id, text, now: this.deps.now().toISOString() }));
  }

  async setChecked(node: ChecklistNode, state: vscode.TreeItemCheckboxState): Promise<void> {
    const project = this.deps.signals.current?.project;
    if (!project || node.type !== "item" || node.item.kind !== "manual") { return; }
    const { id } = node.item.manual;
    const done = state === vscode.TreeItemCheckboxState.Checked;
    await this.editChecklist(project, "set-done", (doc) => setManualItemDone(doc, id, done, this.deps.now().toISOString()));
  }

  async removeItem(node: ChecklistNode): Promise<void> {
    const project = this.deps.signals.current?.project;
    if (!project || node.type !== "item" || node.item.kind !== "manual") { return; }
    const { id } = node.item.manual;
    await this.editChecklist(project, "remove", (doc) => removeManualItem(doc, id));
  }

  /** Moves a reading-list paper to its next status, then reloads the reading list. */
  async nextStatus(node: ChecklistNode): Promise<void> {
    if (node.type !== "item" || node.item.kind !== "reading") { return; }
    const { key, status } = node.item.paper;
    const paperId = this.reading?.paperIds.get(key);
    if (!paperId) { return; }
    const target = nextStatus(status);
    try {
      const failed = await this.deps.setStatus([paperId], target);
      if (failed.length > 0) { throw new Error(`Could not write the status of ${failed.length} paper(s)`); }
    } catch (error) {
      await this.report("Could not update the paper status", error, { action: "next-status", paperId, status: target });
    }
    await this.loadReading();
  }

  /** Writes `checklist.json` and re-reads the signals; a malformed file is reported and left untouched. */
  private async editChecklist(project: ReadyProject, action: string, edit: (doc: ChecklistDocument) => ChecklistDocument): Promise<void> {
    try {
      await this.deps.updateChecklist(project.folder, edit);
    } catch (error) {
      await this.report("Could not update .labshelf/checklist.json", error, { action, folder: project.folder });
      return;
    }
    await this.deps.signals.refresh();
  }

  private async report(message: string, error: unknown, context: Record<string, unknown>): Promise<void> {
    void vscode.window.showErrorMessage(`${message}: ${error instanceof Error ? error.message : String(error)}`);
    await this.deps.logger.error(MODULE, error, context);
  }

  private async rememberExpanded(node: ChecklistNode, expanded: boolean): Promise<void> {
    if (node.type !== "group" || !this.rendered) { return; }
    const { project, grouping } = this.rendered;
    await this.memory.setExpanded(project.folder, grouping, node.group.id, expanded);
  }

  private onSignals(): void {
    const project = this.deps.signals.current?.project;
    if (project && this.reading?.folder !== project.folder) { void this.loadReading(); }
    else { this.render(); }
  }

  private async loadReading(): Promise<void> {
    const project = this.deps.signals.current?.project;
    if (!project) { return; }
    const load = ++this.readingLoads;
    const list = await this.deps.reading.of(project);
    if (load !== this.readingLoads) { return; }
    const items: ReadingItem[] = [];
    const paperIds = new Map<string, string>();
    for (const { key, paper } of list.entries) {
      if (!paper) { continue; }
      items.push({ key, title: paper.title, status: paper.status, ...(paper.statusChangedAt ? { statusChangedAt: paper.statusChangedAt } : {}) });
      paperIds.set(key, paper.id);
    }
    this.reading = { folder: project.folder, items, paperIds };
    this.render();
  }

  // INVARIANT: the context keys are set from here, not from getChildren, because a hidden view is never asked for children.
  private render(): void {
    const current = this.deps.signals.current;
    if (!current) { return this.show([], undefined, 0); }
    const { project, signals, pageOverflow } = current;
    const main = project.main ?? "";
    const grouping = this.memory.grouping(project.folder);
    const reading = this.reading?.folder === project.folder ? this.reading.items : [];
    const checklist = buildChecklist({
      ...signals, pageOverflow, reading, placeSection: sectionPlacer(signals.sources, main), citeSections: citeSections(signals.sources, main),
    }, grouping);
    this.show(checklistNodes(checklist), { project, grouping }, checklist.openCount);
  }

  private show(nodes: ChecklistNode[], rendered: ChecklistView["rendered"], openCount: number): void {
    this.nodes = nodes;
    this.rendered = rendered;
    if (this.view) { this.view.description = openCount > 0 ? String(openCount) : ""; }
    void vscode.commands.executeCommand("setContext", HAS_CHECKLIST_KEY, this.nodes.length > 0);
    void vscode.commands.executeCommand("setContext", BY_SECTION_KEY, rendered?.grouping === "section");
    this.changeEmitter.fire();
  }

  dispose(): void {
    for (const subscription of this.subscriptions) { subscription.dispose(); }
    this.changeEmitter.dispose();
  }
}
