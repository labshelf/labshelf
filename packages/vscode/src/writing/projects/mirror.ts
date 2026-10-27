// Mirrors the open project's Files, Outline and Checklist trees into the Library sidebar and runs what its rows ask for.
import * as vscode from "vscode";

import {
  createDebouncer,
  type ILogger,
  type IconName,
  type ProjectTreeView,
  type SidebarOpenProject,
  type SidebarProjectTree,
  type SidebarTreeNode,
  deriveFileIcon,
  type SidebarNodeIcon,
} from "@labshelf/core";
import type { ProjectTreeMessage } from "../../libraryUi/index.js";
import type { ProjectSession } from "./session.js";
import { disposeAll } from "../../disposables/index.js";

/** What a node's context menu offers for one `contextValue`; `command` runs with the element as its argument. */
interface ProjectTreeMenuEntry { label: string; action: string; danger?: boolean; command: string }

interface WalkInput<T> {
  provider: vscode.TreeDataProvider<T>;
  menus: Record<string, ProjectTreeMenuEntry[]>;
  /** Filled with every walked element by its key, so a webview request finds its element. */
  elements: Map<string, T>;
  /** Shared across a snapshot's views; the walk stops once it reaches 0. */
  budget: { left: number };
}

function labelOf(item: vscode.TreeItem): string {
  if (typeof item.label === "string") { return item.label; }
  if (item.label) { return item.label.label; }
  const path = item.resourceUri?.path ?? "";
  return path.slice(path.lastIndexOf("/") + 1);
}

function iconOf(item: vscode.TreeItem, label: string, folds: boolean): SidebarNodeIcon | undefined {
  const icon = item.iconPath;
  if (icon instanceof vscode.ThemeIcon && icon.id === "arrow-small-right") { return { kind: "glyph", name: "arrow-right" }; }
  return item.resourceUri && !folds ? deriveFileIcon(labelOf(item) || label) : undefined;
}

function checkedOf(state: vscode.TreeItem["checkboxState"]): boolean | undefined {
  if (state === undefined) { return undefined; }
  const value = typeof state === "number" ? state : state.state;
  return value === vscode.TreeItemCheckboxState.Checked;
}

function tooltipOf(tooltip: vscode.TreeItem["tooltip"]): string | undefined {
  if (typeof tooltip === "string") { return tooltip; }
  return tooltip instanceof vscode.MarkdownString ? tooltip.value : undefined;
}

async function nodeOf<T>(input: WalkInput<T>, element: T, item: vscode.TreeItem, key: string): Promise<SidebarTreeNode> {
  const label = labelOf(item);
  const folds = item.collapsibleState !== undefined && item.collapsibleState !== vscode.TreeItemCollapsibleState.None;
  const node: SidebarTreeNode = { key, label };
  if (typeof item.description === "string" && item.description) { node.description = item.description; }
  const tooltip = tooltipOf(item.tooltip);
  if (tooltip) { node.tooltip = tooltip; }
  const icon = iconOf(item, label, folds);
  if (icon) { node.icon = icon; }
  const checked = checkedOf(item.checkboxState);
  if (checked !== undefined) { node.checked = checked; }
  if (item.command) { node.clickable = true; }
  const menu = item.contextValue ? input.menus[item.contextValue] : undefined;
  if (menu?.length) { node.menu = menu.map(({ label: l, action, danger }) => ({ label: l, action, ...(danger ? { danger } : {}) })); }
  if (folds) {
    node.open = item.collapsibleState === vscode.TreeItemCollapsibleState.Expanded;
    node.children = await walkTree(input, element, key);
  }
  return node;
}

/** @returns the children of `parent` (the roots when undefined), each keyed by its item id or its label path */
async function walkTree<T>(input: WalkInput<T>, parent: T | undefined, parentKey: string): Promise<SidebarTreeNode[]> {
  const children = (await input.provider.getChildren(parent)) ?? [];
  const nodes: SidebarTreeNode[] = [];
  const seen = new Map<string, number>();
  for (const element of children) {
    if (input.budget.left <= 0) { break; }
    input.budget.left--;
    const item = await input.provider.getTreeItem(element);
    const base = item.id ?? `${parentKey}/${labelOf(item)}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    const key = n === 0 ? base : `${base}#${n}`;
    input.elements.set(key, element);
    nodes.push(await nodeOf(input, element, item, key));
  }
  return nodes;
}

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
  private readonly changeSoon = createDebouncer(() => this.changeEmitter.fire(), CHANGE_DEBOUNCE_MS);

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
    this.changeSoon.call();
  }

  dispose(): void {
    this.changeSoon.cancel();
    disposeAll(this.subscriptions);
    this.changeEmitter.dispose();
  }
}
