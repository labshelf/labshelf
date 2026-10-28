// The Projects section of the sidebar: its rows grouped by folder, and the host menus and sharing entries that open a project.
import { renderElement, showMenu } from "../../../ui/dom/index.js";
import { renderIcon, escapeHtml } from "../../../ui/index.js";
import type { SidebarProject } from "../../folderModel.js";
import { GROUP_ROW_DEPTH, renderProjectFolderRow, renderProjectRow, formatLabel, renderTreeItem, type SidebarState } from "./sidebarView.js";
import { runShareProjectDialog } from "../../../collab/dom/index.js";
import type { SidebarNodeIcon, SidebarOpenProject, SidebarProjectTree, SidebarTreeNode } from "../../folderModel.js";
import { renderGroupRow, openTreeInput, renderTreeInputRow } from "./librarySidebar.js";

/** What the Projects section asks the host to do. Folder paths are project folder paths ("" for the top level). */
export interface SidebarProjectActions {
  open(id: string): void;
  /** The host shows its own menu at the pointer. */
  menu(id: string, at: { x: number; y: number }): void;
  browseTemplates(): void;
  /** Opens the tab that lists every project, archived and trashed ones included. */
  allProjects(): void;
  newBlank(): void;
  addExisting(): void;
  newFolder(parent: string): void;
  renameFolder(path: string): void;
  deleteFolder(path: string): void;
  refresh(): void;
  closeProject(): void;
  /** The host shows the open project's menu below its title row. */
  openProjectMenu(anchor: HTMLElement): void;
  /** A button in a tree pane's header; `action` is the tree's own action id. */
  treeAction(action: string): void;
  treeClick(view: string, key: string): void;
  treeToggle(view: string, key: string, open: boolean): void;
  treeCheck(view: string, key: string, checked: boolean): void;
  treeMenu(view: string, key: string, action: string): void;
  /** Text typed in a row's inline add input; `key` is the row's. */
  treeAdd(view: string, key: string, text: string): void;
}

/** Which project actions the host can run; the sidebar leaves out the buttons of the others. */
export interface ProjectOffers {
  templates: boolean;
  addExisting: boolean;
  newBlank: boolean;
  /** Creating, renaming and deleting the folders of My projects. */
  projectFolders: boolean;
  /** The All projects row. */
  allProjects: boolean;
}

export const ALL_PROJECT_OFFERS: ProjectOffers = { templates: true, addExisting: true, newBlank: true, projectFolders: true, allProjects: true };

/** Expansion keys of project folders share the sidebar's expanded set with library folder paths. */
export const createProjectFolderKey = (path: string): string => `project-folder:${path}`;

// The Explorer's own title actions, in its order: new file, new folder, refresh, collapse all.
export const createProjectListActions = (offers: ProjectOffers, canJoin: boolean): string =>
  (offers.newBlank ? `<button class="ls-icon-btn" data-tree="blank" title="New blank project">${renderIcon("new-file")}</button>` : "") +
  (offers.projectFolders ? `<button class="ls-icon-btn" data-tree="project-folder" title="New folder">${renderIcon("new-folder")}</button>` : "") +
  (canJoin ? `<button class="ls-icon-btn" data-tree="join" title="Join Shared Project" aria-label="Join Shared Project">${renderIcon("link")}</button>` : "") +
  `<button class="ls-icon-btn" data-tree="project-refresh" title="Refresh">${renderIcon("reload")}</button>` +
  `<button class="ls-icon-btn" data-tree="project-collapse" title="Collapse all">${renderIcon("collapse-all")}</button>`;

const emptyButton = (action: string, label: string, glyph: "plus" | "folder-plus" | "folder-open" | "link"): string =>
  `<button class="ls-btn" data-tree="${action}" tabindex="-1">${renderIcon(glyph)}${label}</button>`;

function emptyState(offers: ProjectOffers, canJoin: boolean): HTMLElement {
  const buttons = (offers.templates ? emptyButton("browse", "Browse templates", "plus") : "") +
    (offers.newBlank ? emptyButton("blank", "New blank project", "folder-plus") : "") +
    (offers.addExisting ? emptyButton("add", "Add existing folder", "folder-open") : "") +
    (canJoin ? emptyButton("join", "Join shared project", "link") : "");
  return renderElement("div", { class: "tree-empty", html: buttons ? `No projects yet.<div class="tree-empty-actions">${buttons}</div>` : "No projects yet." });
}

const byName = (a: SidebarProject, b: SidebarProject): number => a.name.localeCompare(b.name);

/** My projects: folders first, then projects, each level sorted by name; a folder's count is every project under it. */
export function renderProjectTreeNodes(projects: readonly SidebarProject[], expanded: ReadonlySet<string>, offers: ProjectOffers, canJoin: boolean): HTMLElement[] {
  const active = projects.filter((p) => !p.hidden);
  if (active.length === 0) return [emptyState(offers, canJoin)];
  const rows: HTMLElement[] = [];
  const walk = (prefix: string, depth: number): void => {
    const under = active.filter((p) => p.folder !== undefined && (prefix === "" || p.folder.startsWith(`${prefix}/`)));
    const children = [...new Set(under.map((p) => p.folder!.slice(prefix ? prefix.length + 1 : 0).split("/")[0]!))].sort();
    for (const name of children) {
      const path = prefix ? `${prefix}/${name}` : name;
      const open = expanded.has(createProjectFolderKey(path));
      const count = active.filter((p) => p.folder === path || p.folder?.startsWith(`${path}/`)).length;
      rows.push(renderProjectFolderRow(name, path, { depth, count, open, current: false }));
      if (open) walk(path, depth + 1);
    }
    for (const p of active.filter((q) => (q.folder ?? "") === prefix).sort(byName)) rows.push(renderProjectRow(p, depth));
  };
  walk("", GROUP_ROW_DEPTH);
  return rows;
}

const iconHtml = (i: SidebarNodeIcon | undefined): string => {
  if (!i) return "";
  if (i.kind === "glyph") return `<span class="tree-icon">${renderIcon(i.name)}</span>`;
  if (i.kind === "dot") return `<span class="tree-icon"><span class="tree-dot ${i.tone}"></span></span>`;
  return `<span class="tree-ref ${i.tone}">${escapeHtml(i.text)}</span>`;
};

const nodeKey = (view: string, key: string): string => `${view}:${key}`;

/** Whether a folding node is open: the user's last toggle, else the host's default. */
const isNodeOpen = (t: SidebarState, view: string, n: SidebarTreeNode): boolean => t.treeOpen.get(nodeKey(view, n.key)) ?? n.open ?? false;

function nodeRow(t: SidebarState, view: string, n: SidebarTreeNode, depth: number): HTMLElement {
  const folds = n.children !== undefined;
  const open = folds && isNodeOpen(t, view, n);
  const check = n.checked === undefined ? "" : `<input type="checkbox" class="tree-check" tabindex="-1"${n.checked ? " checked" : ""} aria-label="Done">`;
  const trailing = n.trailing
    ? `<button class="tree-trailing" data-tree="node-action" data-action="${escapeHtml(n.trailing.action)}" title="${escapeHtml(n.trailing.tooltip)}" aria-label="${escapeHtml(n.trailing.tooltip)}">${iconHtml(n.trailing.icon)}</button>` : "";
  const inline = n.inlineAction
    ? `<button class="tree-inline-action" data-tree="node-action" data-action="${escapeHtml(n.inlineAction.action)}">${escapeHtml(n.inlineAction.label)}</button>` : "";
  const row = renderTreeItem(`tree:${view}:${n.key}`, depth, false, {
    "data-tree-view": view, "data-tree-key": n.key, "aria-selected": "false",
    "aria-expanded": folds ? String(open) : undefined, title: n.tooltip,
  }, `<span class="tree-twisty${folds ? "" : " leaf"}">${renderIcon("chevron-down")}</span>${check}${iconHtml(n.icon)}` +
    `<span class="tree-label">${escapeHtml(n.label)}</span>` + (n.description ? `<span class="tree-desc">${escapeHtml(n.description)}</span>` : "") +
    (n.addable ? `<button class="ls-icon-btn tree-add" data-tree="node-add" title="Add item" aria-label="Add item">${renderIcon("plus")}</button>` : "") +
    inline + trailing);
  row.classList.toggle("dim", n.dim === true);
  row.classList.toggle("struck", n.struck === true);
  return row;
}

function appendNodes(t: SidebarState, body: HTMLElement, view: string, nodes: readonly SidebarTreeNode[], depth: number, render: () => void): void {
  for (const n of nodes) {
    body.append(nodeRow(t, view, n, depth));
    if (n.children && isNodeOpen(t, view, n)) appendNodes(t, body, view, n.children, depth + 1, render);
    if (t.treeInput?.view === view && t.treeInput.key === n.key) body.append(renderTreeInputRow(t, depth + 1, render));
  }
}

function toggleRow(toggle: NonNullable<SidebarProjectTree["toggle"]>): HTMLElement {
  const options = toggle.options.map((o) =>
    `<button data-tree="project-tree-action" data-action="${escapeHtml(o.action)}" aria-pressed="${o.action === toggle.selected}">${escapeHtml(o.label)}</button>`).join("");
  return renderElement("div", { class: "tree-toggle-row", style: `--depth:${GROUP_ROW_DEPTH}`, html: `<span class="tree-toggle">${options}</span>` });
}

function openProjectRow(p: SidebarOpenProject, canShare: boolean): HTMLElement {
  const label = escapeHtml(`Share "${p.name}"`);
  const shareButton = canShare ? `<button class="ls-icon-btn" data-tree="share-project" title="${label}" aria-label="${label}">${renderIcon("link")}</button>` : "";
  return renderElement("div", {
    class: "tree-row tree-open-project", role: "treeitem", "data-key": "open-project", "data-open-project": p.id, style: "--depth:0", title: p.name,
    "aria-haspopup": "menu",
    html: `${formatLabel(p.format)}<span class="tree-label">${escapeHtml(p.name)}</span><span class="tree-open-project-chevron" aria-hidden="true">${renderIcon("chevron-down")}</span>` +
      `<span class="tree-row-actions">${shareButton}<button class="ls-icon-btn" data-tree="close-project" title="Close project">${renderIcon("x")}</button></span>`,
  });
}

/** Appends the project row, then one foldable pane per tree, to the Projects body. */
export function addOpenProject(
  t: SidebarState, body: HTMLElement, appendPane: (parent: HTMLElement, id: `project.${string}`, header: HTMLElement, open: boolean) => HTMLElement, render: () => void,
): void {
  const p = t.openProject;
  if (!p) return;
  body.append(openProjectRow(p, t.sharing?.offers().projects === true));
  for (const tree of p.trees) {
    const id = `project.${tree.view}` as const;
    const open = !t.collapsed.has(id);
    const actions = tree.actions.map((a) => `<button class="ls-icon-btn" data-tree="project-tree-action" data-action="${escapeHtml(a.action)}" title="${escapeHtml(a.label)}">${renderIcon(a.icon)}</button>`).join("");
    const header = renderGroupRow(id, tree.title, open, actions);
    const pane = appendPane(body, id, header, open);
    if (!open) continue;
    if (tree.toggle) pane.append(toggleRow(tree.toggle));
    if (tree.nodes.length === 0) pane.append(renderElement("div", { class: "tree-empty", text: tree.empty }));
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
export function runTreeRow(t: SidebarState, r: HTMLElement, render: () => void, onTwisty = false): boolean {
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
  if (action?.dataset["tree"] === "share-project") { if (t.sharing && t.openProject) void runShareProjectDialog(t.sharing, t.openProject.id); return true; }
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
