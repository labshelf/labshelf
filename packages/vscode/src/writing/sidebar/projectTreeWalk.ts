// Walks a native TreeDataProvider into the serialisable nodes the sidebar webview draws.
import * as vscode from "vscode";

import { fileIcon, type SidebarNodeIcon, type SidebarTreeNode } from "@labshelf/core";

/** What a node's context menu offers for one `contextValue`; `command` runs with the element as its argument. */
export interface ProjectTreeMenuEntry { label: string; action: string; danger?: boolean; command: string }

export interface WalkInput<T> {
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
  return item.resourceUri && !folds ? fileIcon(labelOf(item) || label) : undefined;
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
export async function walkTree<T>(input: WalkInput<T>, parent: T | undefined, parentKey: string): Promise<SidebarTreeNode[]> {
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
