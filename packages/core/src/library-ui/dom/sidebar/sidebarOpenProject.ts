// Renders the open project at the top of Projects (its title row, then its Files, Outline and Checklist trees) and acts on their rows.
import { el, showMenu } from "../../../ui/dom/index.js";
import { escapeHtml, icon } from "../../../ui/index.js";
import type { SidebarNodeIcon, SidebarOpenProject, SidebarProjectTree, SidebarTreeNode } from "../../sidebarTrees.js";
import { GROUP_ROW_DEPTH, formatLabel, treeItem } from "./sidebarRows.js";
import { groupRow } from "./sidebarSections.js";
import { openTreeInput, treeInputRow } from "./sidebarTreeInput.js";
import type { SidebarState } from "./sidebarView.js";

const iconHtml = (i: SidebarNodeIcon | undefined): string => {
  if (!i) return "";
  if (i.kind === "glyph") return `<span class="tree-icon">${icon(i.name)}</span>`;
  if (i.kind === "dot") return `<span class="tree-icon"><span class="tree-dot ${i.tone}"></span></span>`;
  return `<span class="tree-ref ${i.tone}">${escapeHtml(i.text)}</span>`;
};

const nodeKey = (view: string, key: string): string => `${view}:${key}`;

/** Whether a folding node is open: the user's last toggle, else the host's default. */
export const isNodeOpen = (t: SidebarState, view: string, n: SidebarTreeNode): boolean => t.treeOpen.get(nodeKey(view, n.key)) ?? n.open ?? false;

function nodeRow(t: SidebarState, view: string, n: SidebarTreeNode, depth: number): HTMLElement {
  const folds = n.children !== undefined;
  const open = folds && isNodeOpen(t, view, n);
  const check = n.checked === undefined ? "" : `<input type="checkbox" class="tree-check" tabindex="-1"${n.checked ? " checked" : ""} aria-label="Done">`;
  const trailing = n.trailing
    ? `<button class="tree-trailing" data-tree="node-action" data-action="${escapeHtml(n.trailing.action)}" title="${escapeHtml(n.trailing.tooltip)}" aria-label="${escapeHtml(n.trailing.tooltip)}">${iconHtml(n.trailing.icon)}</button>` : "";
  const inline = n.inlineAction
    ? `<button class="tree-inline-action" data-tree="node-action" data-action="${escapeHtml(n.inlineAction.action)}">${escapeHtml(n.inlineAction.label)}</button>` : "";
  const row = treeItem(`tree:${view}:${n.key}`, depth, false, {
    "data-tree-view": view, "data-tree-key": n.key, "aria-selected": "false",
    "aria-expanded": folds ? String(open) : undefined, title: n.tooltip,
  }, `<span class="tree-twisty${folds ? "" : " leaf"}">${icon("chevron-down")}</span>${check}${iconHtml(n.icon)}` +
    `<span class="tree-label">${escapeHtml(n.label)}</span>` + (n.description ? `<span class="tree-desc">${escapeHtml(n.description)}</span>` : "") +
    (n.addable ? `<button class="ls-icon-btn tree-add" data-tree="node-add" title="Add item" aria-label="Add item">${icon("plus")}</button>` : "") +
    inline + trailing);
  row.classList.toggle("dim", n.dim === true);
  row.classList.toggle("struck", n.struck === true);
  return row;
}

function appendNodes(t: SidebarState, body: HTMLElement, view: string, nodes: readonly SidebarTreeNode[], depth: number, render: () => void): void {
  for (const n of nodes) {
    body.append(nodeRow(t, view, n, depth));
    if (n.children && isNodeOpen(t, view, n)) appendNodes(t, body, view, n.children, depth + 1, render);
    if (t.treeInput?.view === view && t.treeInput.key === n.key) body.append(treeInputRow(t, depth + 1, render));
  }
}

function toggleRow(toggle: NonNullable<SidebarProjectTree["toggle"]>): HTMLElement {
  const options = toggle.options.map((o) =>
    `<button data-tree="project-tree-action" data-action="${escapeHtml(o.action)}" aria-pressed="${o.action === toggle.selected}">${escapeHtml(o.label)}</button>`).join("");
  return el("div", { class: "tree-toggle-row", style: `--depth:${GROUP_ROW_DEPTH}`, html: `<span class="tree-toggle">${options}</span>` });
}

function openProjectRow(p: SidebarOpenProject): HTMLElement {
  return el("div", {
    class: "tree-row tree-open-project", role: "treeitem", "data-key": "open-project", "data-open-project": p.id, style: "--depth:0", title: p.name,
    "aria-haspopup": "menu",
    html: `${formatLabel(p.format)}<span class="tree-label">${escapeHtml(p.name)}</span><span class="tree-open-project-chevron" aria-hidden="true">${icon("chevron-down")}</span>` +
      `<span class="tree-row-actions"><button class="ls-icon-btn" data-tree="close-project" title="Close project">${icon("x")}</button></span>`,
  });
}

/** Appends the project row, then one foldable pane per tree, to the Projects body. */
export function appendOpenProject(
  t: SidebarState, body: HTMLElement, appendPane: (parent: HTMLElement, id: `project.${string}`, header: HTMLElement, open: boolean) => HTMLElement, render: () => void,
): void {
  const p = t.openProject;
  if (!p) return;
  body.append(openProjectRow(p));
  for (const tree of p.trees) {
    const id = `project.${tree.view}` as const;
    const open = !t.collapsed.has(id);
    const actions = tree.actions.map((a) => `<button class="ls-icon-btn" data-tree="project-tree-action" data-action="${escapeHtml(a.action)}" title="${escapeHtml(a.label)}">${icon(a.icon)}</button>`).join("");
    const header = groupRow(id, tree.title, open, actions);
    const pane = appendPane(body, id, header, open);
    if (!open) continue;
    if (tree.toggle) pane.append(toggleRow(tree.toggle));
    if (tree.nodes.length === 0) pane.append(el("div", { class: "tree-empty", text: tree.empty }));
    else appendNodes(t, pane, tree.view, tree.nodes, GROUP_ROW_DEPTH, render);
  }
}

function findNode(nodes: readonly SidebarTreeNode[], key: string): SidebarTreeNode | undefined {
  for (const n of nodes) {
    if (n.key === key) return n;
    const inner = n.children && findNode(n.children, key);
    if (inner) return inner;
  }
  return undefined;
}

const treeOf = (t: SidebarState, view: string): SidebarProjectTree | undefined => t.openProject?.trees.find((x) => x.view === view);

function rowNode(t: SidebarState, r: HTMLElement): { view: string; node: SidebarTreeNode } | undefined {
  const view = r.dataset["treeView"];
  const key = r.dataset["treeKey"];
  const tree = view === undefined ? undefined : treeOf(t, view);
  const node = tree && key !== undefined ? findNode(tree.nodes, key) : undefined;
  return node && view ? { view, node } : undefined;
}

function toggle(t: SidebarState, view: string, n: SidebarTreeNode, render: () => void): void {
  const open = !isNodeOpen(t, view, n);
  t.treeOpen.set(nodeKey(view, n.key), open);
  t.projects?.treeToggle(view, n.key, open);
  render();
}

/** Runs a tree row as a click or Enter does: the open project's menu, a row's command, else a fold; `onTwisty` folds without running. */
export function activateTreeRow(t: SidebarState, r: HTMLElement, render: () => void, onTwisty = false): boolean {
  if (r.dataset["openProject"] !== undefined) { t.projects?.openProjectMenu(r); return true; }
  const hit = rowNode(t, r);
  if (!hit) return false;
  const { view, node } = hit;
  if (node.children && (onTwisty || !node.clickable)) toggle(t, view, node, render);
  else if (node.clickable) t.projects?.treeClick(view, node.key);
  return true;
}

/** Opens a row's inline add input, unfolding the row first so the input shows below its children. */
function addUnder(t: SidebarState, view: string, n: SidebarTreeNode, render: () => void): void {
  if (n.children && !isNodeOpen(t, view, n)) { t.treeOpen.set(nodeKey(view, n.key), true); t.projects?.treeToggle(view, n.key, true); }
  openTreeInput(t, view, n.key, n.addable?.placeholder ?? "", render);
}

/** Handles the open project's title row, buttons and checkboxes; false when the click is not theirs. */
export function onOpenProjectClick(e: MouseEvent, t: SidebarState, render: () => void): boolean {
  const target = e.target as HTMLElement;
  const action = target.closest<HTMLElement>("[data-tree]");
  if (action?.dataset["tree"] === "close-project") { t.projects?.closeProject(); return true; }
  const projectRow = target.closest<HTMLElement>("[data-open-project]");
  if (projectRow) { t.projects?.openProjectMenu(projectRow); return true; }
  if (action?.dataset["tree"] === "node-add") {
    const r = action.closest<HTMLElement>("[data-tree-key]");
    const hit = r && rowNode(t, r);
    if (hit) addUnder(t, hit.view, hit.node, render);
    return true;
  }
  if (action?.dataset["tree"] === "node-action") {
    const r = action.closest<HTMLElement>("[data-tree-key]");
    const hit = r && rowNode(t, r);
    if (hit) t.projects?.treeMenu(hit.view, hit.node.key, action.dataset["action"] ?? "");
    return true;
  }
  if (action?.dataset["tree"] === "project-tree-action") { t.projects?.treeAction(action.dataset["action"] ?? ""); return true; }
  if (target.matches("input.tree-check")) {
    const r = target.closest<HTMLElement>("[data-tree-key]");
    const hit = r && rowNode(t, r);
    if (hit) t.projects?.treeCheck(hit.view, hit.node.key, (target as HTMLInputElement).checked);
    return true;
  }
  return false;
}

/** Shows a tree row's menu; false when the row has none. */
export function onOpenProjectMenu(e: MouseEvent, t: SidebarState, r: HTMLElement): boolean {
  const hit = rowNode(t, r);
  if (!hit?.node.menu?.length) return false;
  e.preventDefault();
  const { view, node } = hit;
  showMenu({ x: e.clientX, y: e.clientY }, node.menu!.map((m) => ({ label: m.label, danger: m.danger ?? false, onSelect: () => t.projects?.treeMenu(view, node.key, m.action) })));
  return true;
}
