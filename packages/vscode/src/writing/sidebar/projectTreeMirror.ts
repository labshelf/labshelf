// Mirrors the open project's Files, Outline and Checklist trees into the Library sidebar and runs what its rows ask for.
import * as vscode from "vscode";

import type { ILogger, IconName, ProjectTreeView, SidebarOpenProject, SidebarProjectTree, SidebarTreeNode } from "@labshelf/core";
import type { ProjectTreeMessage } from "../../libraryUi/index.js";
import type { ProjectSession } from "../session/index.js";
import { walkTree, type ProjectTreeMenuEntry } from "./projectTreeWalk.js";

const MODULE = "projectTreeMirror";
const CHANGE_DEBOUNCE_MS = 100;
/** Bounds a snapshot over a huge project folder; past it the trees show only what was walked. */
const NODE_CAP = 3000;

interface TreeSpecBase {
  view: ProjectTreeView;
  title: string;
  actions: TreeSpecAction[];
  empty: string;
}

interface TreeSpecAction {
  action: string;
  label: string;
  icon: IconName;
  run(): unknown;
}

/** A tree walked from a native TreeDataProvider. */
export interface WalkedTreeSpec<T> extends TreeSpecBase {
  provider: vscode.TreeDataProvider<T>;
  /** Context menus by the TreeItem's `contextValue`. */
  menus: Record<string, ProjectTreeMenuEntry[]>;
  onToggle?(element: T, open: boolean): unknown;
  onCheck?(element: T, checked: boolean): unknown;
}

/** A tree that builds its sidebar nodes itself and answers its rows' requests by key. */
export interface BuiltTreeSpec extends TreeSpecBase {
  onDidChange: vscode.Event<void>;
  nodes(): SidebarTreeNode[];
  toggle?(): { options: Array<{ action: string; label: string; run(): unknown }>; selected: string };
  handle(request: ProjectTreeRequest): unknown;
}

export type ProjectTreeSpec<T> = WalkedTreeSpec<T> | BuiltTreeSpec;

const isBuilt = (spec: ProjectTreeSpec<unknown>): spec is BuiltTreeSpec => "nodes" in spec;

/** What the sidebar asks of a mirrored tree. */
export type ProjectTreeRequest = Omit<ProjectTreeMessage, "type">;

export interface ProjectTreeMirrorDeps {
  session: Pick<ProjectSession, "project" | "onDidChange">;
  specs: Array<ProjectTreeSpec<unknown>>;
  logger: ILogger;
}

export class ProjectTreeMirror implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  /** Fires, debounced, when the open project or any of its trees change. */
  readonly onDidChange = this.changeEmitter.event;
  private readonly subscriptions: vscode.Disposable[] = [];
  private readonly elements = new Map<ProjectTreeView, Map<string, unknown>>();
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly deps: ProjectTreeMirrorDeps) {
    const changed = (): void => this.scheduleChange();
    this.subscriptions.push(deps.session.onDidChange(changed));
    for (const spec of deps.specs) {
      const event = isBuilt(spec) ? spec.onDidChange : spec.provider.onDidChangeTreeData;
      if (event) { this.subscriptions.push(event(changed)); }
    }
  }

  /** @returns the open project with its trees, or null when none is open */
  async snapshot(): Promise<SidebarOpenProject | null> {
    const project = this.deps.session.project;
    if (!project) { this.elements.clear(); return null; }
    const budget = { left: NODE_CAP };
    const trees: SidebarProjectTree[] = [];
    for (const spec of this.deps.specs) { trees.push(await this.tree(spec, budget)); }
    if (budget.left <= 0) { void this.deps.logger.log("WARN", MODULE, "Project trees cut at the node cap", { project: project.folder, cap: NODE_CAP }); }
    return { id: project.folder, name: project.settings.title ?? project.settings.id, format: project.settings.format, trees };
  }

  private async tree(spec: ProjectTreeSpec<unknown>, budget: { left: number }): Promise<SidebarProjectTree> {
    let nodes: SidebarProjectTree["nodes"] = [];
    try {
      nodes = isBuilt(spec) ? spec.nodes() : await this.walk(spec, budget);
    } catch (error) {
      void this.deps.logger.error(MODULE, error, { op: "snapshot", view: spec.view });
    }
    const toggle = isBuilt(spec) ? spec.toggle?.() : undefined;
    return {
      view: spec.view, title: spec.title, actions: spec.actions.map(({ run: _run, ...action }) => action),
      nodes, empty: spec.empty,
      ...(toggle ? { toggle: { options: toggle.options.map(({ action, label }) => ({ action, label })), selected: toggle.selected } } : {}),
    };
  }

  private async walk(spec: WalkedTreeSpec<unknown>, budget: { left: number }): Promise<SidebarTreeNode[]> {
    const elements = new Map<string, unknown>();
    this.elements.set(spec.view, elements);
    return walkTree({ provider: spec.provider, menus: spec.menus, elements, budget }, undefined, spec.view);
  }

  /** Runs a sidebar request; a request for an unknown row is logged and ignored. */
  async handle(request: ProjectTreeRequest): Promise<void> {
    try {
      await this.run(request);
    } catch (error) {
      void this.deps.logger.error(MODULE, error, { ...request });
    }
  }

  private async run(request: ProjectTreeRequest): Promise<void> {
    if (request.op === "close") { await vscode.commands.executeCommand("labshelf.writing.closeProject"); return; }
    if (request.op === "action") {
      const action = this.deps.specs.flatMap((s) => [...s.actions, ...(isBuilt(s) ? s.toggle?.().options ?? [] : [])])
        .find((a) => a.action === request.action);
      if (action) { await action.run(); }
      return;
    }
    const spec = this.deps.specs.find((s) => s.view === request.view);
    if (spec && isBuilt(spec)) { await spec.handle(request); return; }
    const element = request.key === undefined ? undefined : this.elements.get(request.view!)?.get(request.key);
    if (!spec || element === undefined) {
      void this.deps.logger.log("WARN", MODULE, "Project tree request for an unknown row", { ...request });
      return;
    }
    switch (request.op) {
      case "click": {
        const command = (await spec.provider.getTreeItem(element)).command;
        if (command) { await vscode.commands.executeCommand(command.command, ...(command.arguments ?? [])); }
        break;
      }
      case "toggle": await spec.onToggle?.(element, request.open === true); break;
      case "check": await spec.onCheck?.(element, request.checked === true); break;
      case "menu": {
        const entry = Object.values(spec.menus).flat().find((m) => m.action === request.action);
        if (entry) { await vscode.commands.executeCommand(entry.command, element); }
        break;
      }
    }
  }

  private scheduleChange(): void {
    if (this.timer) { clearTimeout(this.timer); }
    this.timer = setTimeout(() => { this.timer = undefined; this.changeEmitter.fire(); }, CHANGE_DEBOUNCE_MS);
  }

  dispose(): void {
    if (this.timer) { clearTimeout(this.timer); }
    for (const s of this.subscriptions) { s.dispose(); }
    this.changeEmitter.dispose();
  }
}
