// Builds the open project's Checklist for the sidebar and runs what its rows ask for.
import * as vscode from "vscode";

import {
  MANUAL_ITEM_GROUPS, addManualItem, buildChecklist, checklistSidebarNodes, citeSections, nextStatus, removeManualItem, sectionPlacer, setManualItemDone,
  type Checklist, type ChecklistDocument, type ChecklistGrouping, type ChecklistItem, type ILogger, type ManualItemGroup, type PaperStatus, type PathOps,
  type ReadingItem, type ReadingPaper, type SidebarTreeNode,
} from "@labshelf/core";
import type { FigureNode, ReadyProject } from "../figures/index.js";
import { REVEAL_OUTLINE_COMMAND } from "../outline/index.js";
import type { ProjectReadingLists } from "../readingList/index.js";
import type { ProjectTreeRequest } from "../sidebar/index.js";
import { ChecklistMemory } from "./checklistMemory.js";
import type { OpenProjectSignals, ProjectSignals } from "./openProjectSignals.js";

const MODULE = "writing/checklist";
const REGENERATE_FIGURE_COMMAND = "labshelf.writing.regenerateFigure";

export interface ChecklistViewDeps {
  paths: PathOps;
  signals: Pick<OpenProjectSignals, "current" | "onDidChange" | "refresh">;
  reading: Pick<ProjectReadingLists, "of"> & { onDidChange: vscode.Event<void> };
  memory: vscode.Memento;
  setStatus: (paperIds: string[], status: PaperStatus) => Promise<string[]>;
  updateChecklist: (folder: string, edit: (doc: ChecklistDocument) => ChecklistDocument) => Promise<void>;
  logger: ILogger;
  newId: () => string;
  now: () => Date;
}

interface ReadingCache { folder: string; items: ReadingItem[]; papers: Map<string, ReadingPaper> }

interface Rendered { project: ReadyProject; grouping: ChecklistGrouping; checklist: Checklist; pageCount: ProjectSignals["pageCount"] }

export class ChecklistView implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;
  private readonly subscriptions: vscode.Disposable[];
  private readonly memory: ChecklistMemory;
  private rendered: Rendered | undefined;
  /** The last built tree's items and groups by row key, so a row request finds what it names. */
  private items = new Map<string, ChecklistItem>();
  private groups = new Map<string, string>();
  private reading: ReadingCache | undefined;
  /** Bumped on every reading-list load so a load that finishes late is dropped. */
  private readingLoads = 0;

  constructor(private readonly deps: ChecklistViewDeps) {
    this.memory = new ChecklistMemory(deps.memory);
    this.subscriptions = [deps.signals.onDidChange(() => this.onSignals()), deps.reading.onDidChange(() => void this.loadReading())];
    this.onSignals();
  }

  get grouping(): ChecklistGrouping { return this.rendered?.grouping ?? "kind"; }

  nodes(): SidebarTreeNode[] {
    const rendered = this.rendered;
    if (!rendered) { this.items.clear(); this.groups.clear(); return []; }
    const { project, grouping, checklist, pageCount } = rendered;
    const tree = checklistSidebarNodes({
      paths: this.deps.paths, checklist, grouping, pageCount, reading: this.reading?.folder === project.folder ? this.reading.papers : new Map(),
      isExpanded: (groupId, byDefault) => this.memory.isExpanded(project.folder, grouping, groupId, byDefault),
    });
    this.items = tree.items;
    this.groups = tree.groups;
    return tree.nodes;
  }

  async setGrouping(grouping: ChecklistGrouping): Promise<void> {
    const project = this.deps.signals.current?.project;
    if (!project || this.memory.grouping(project.folder) === grouping) { return; }
    await this.memory.setGrouping(project.folder, grouping);
    this.render();
  }

  /** Runs a Checklist row's request; a request for a row the last tree did not have is logged and ignored. */
  async handle(request: ProjectTreeRequest): Promise<void> {
    const key = request.key ?? "";
    if (request.op === "toggle") {
      const groupId = this.groups.get(key);
      if (groupId && this.rendered) { await this.memory.setExpanded(this.rendered.project.folder, this.rendered.grouping, groupId, request.open === true); }
      return;
    }
    if (request.op === "add") { await this.addToRow(key, request.text ?? ""); return; }
    const item = this.items.get(key);
    if (!item) {
      void this.deps.logger.log("WARN", MODULE, "Checklist request for an unknown row", { ...request });
      return;
    }
    if (request.op === "click") { await this.reveal(item); }
    else if (request.op === "check") { await this.setChecked(item, request.checked === true); }
    else if (request.op === "menu" && request.action === "removeItem") { await this.removeItem(item); }
    else if (request.op === "menu" && request.action === "nextStatus") { await this.nextStatus(item); }
    else if (request.op === "menu" && request.action === "regenerate") { await this.regenerate(item); }
  }

  async addItem(): Promise<void> {
    if (!this.deps.signals.current) { await this.deps.signals.refresh(); }
    const project = this.deps.signals.current?.project;
    if (!project) { return; }
    const text = (await vscode.window.showInputBox({ prompt: "New checklist item", ignoreFocusOut: true }))?.trim();
    if (text) { await this.add(project, text, {}); }
  }

  /** Adds an item typed under a group row: to that By kind group (My items for "manual"), or to that By section group. */
  private async addToRow(key: string, raw: string): Promise<void> {
    const project = this.deps.signals.current?.project;
    const text = raw.trim();
    const groupId = this.groups.get(key);
    const bySection = this.rendered?.grouping === "section";
    const group = !bySection && (MANUAL_ITEM_GROUPS as readonly string[]).includes(groupId ?? "") ? groupId as ManualItemGroup : undefined;
    const known = groupId !== undefined && (bySection ? groupId !== "#reading" : group !== undefined || groupId === "manual");
    if (!project || !text || !known) {
      void this.deps.logger.log("WARN", MODULE, "Checklist add for an unknown row", { key, project: project?.folder });
      return;
    }
    await this.add(project, text, bySection ? { section: groupId } : group ? { group } : {});
  }

  private async add(project: ReadyProject, text: string, place: { group?: ManualItemGroup; section?: string }): Promise<void> {
    const id = this.deps.newId();
    await this.editChecklist(project, "add", (doc) => addManualItem(doc, { id, text, now: this.deps.now().toISOString(), ...place }));
  }

  private async setChecked(item: ChecklistItem, done: boolean): Promise<void> {
    const project = this.deps.signals.current?.project;
    if (!project || item.kind !== "manual") { return; }
    const { id } = item.manual;
    await this.editChecklist(project, "set-done", (doc) => setManualItemDone(doc, id, done, this.deps.now().toISOString()));
  }

  private async removeItem(item: ChecklistItem): Promise<void> {
    const project = this.deps.signals.current?.project;
    if (!project || item.kind !== "manual") { return; }
    const { id } = item.manual;
    await this.editChecklist(project, "remove", (doc) => removeManualItem(doc, id));
  }

  private async reveal(item: ChecklistItem): Promise<void> {
    const project = this.rendered?.project;
    const at = item.kind === "todo" ? item.todo : item.kind === "ref" ? item.ref : undefined;
    if (!project || !at) { return; }
    const range = new vscode.Range(at.line, 0, at.line, 0);
    await vscode.commands.executeCommand(REVEAL_OUTLINE_COMMAND, vscode.Uri.file(this.deps.paths.join(project.folder, at.file)), range);
  }

  private async regenerate(item: ChecklistItem): Promise<void> {
    const project = this.rendered?.project;
    if (!project || item.kind !== "figure") { return; }
    const recipe = project.settings.figures?.[item.figure.name];
    if (!recipe) {
      void this.deps.logger.log("WARN", MODULE, "Stale figure has no recipe", { folder: project.folder, figure: item.figure.name });
      return;
    }
    const node: FigureNode = { kind: "figure", project, path: item.figure.name, recipe, state: { status: "stale", newerInputs: [], missingInputs: [] } };
    await vscode.commands.executeCommand(REGENERATE_FIGURE_COMMAND, node);
  }

  /** Moves a reading-list paper to its next status, then reloads the reading list. */
  private async nextStatus(item: ChecklistItem): Promise<void> {
    if (item.kind !== "reading") { return; }
    const { key, status } = item.paper;
    const paperId = this.reading?.papers.get(key)?.paperId;
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
    const papers = new Map<string, ReadingPaper>();
    for (const { key, paper, cited, listed } of list.entries) {
      if (!paper) { continue; }
      items.push({ key, title: paper.title, status: paper.status, ...(paper.statusChangedAt ? { statusChangedAt: paper.statusChangedAt } : {}) });
      papers.set(key, { paperId: paper.id, cited, listed, authors: paper.authors, year: paper.year });
    }
    this.reading = { folder: project.folder, items, papers };
    this.render();
  }

  private render(): void {
    const current = this.deps.signals.current;
    if (!current) { this.rendered = undefined; this.changeEmitter.fire(); return; }
    const { project, signals, pageOverflow, pageCount } = current;
    const main = project.main ?? "";
    const grouping = this.memory.grouping(project.folder);
    const reading = this.reading?.folder === project.folder ? this.reading.items : [];
    const checklist = buildChecklist({
      ...signals, pageOverflow, reading, placeSection: sectionPlacer(signals.sources, main), citeSections: citeSections(signals.sources, main),
    }, grouping);
    this.rendered = { project, grouping, checklist, pageCount };
    this.changeEmitter.fire();
  }

  dispose(): void {
    for (const subscription of this.subscriptions) { subscription.dispose(); }
    this.changeEmitter.dispose();
  }
}
