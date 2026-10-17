// Builds the Projects section rows: the project folder tree with its projects, the archived list, or an empty state with three actions.
import { el } from "../../../ui/dom/index.js";
import { icon } from "../../../ui/index.js";
import { GROUP_ROW_DEPTH, projectFolderRow, projectRow } from "./sidebarRows.js";

/** A writing project as the sidebar lists it; `id` is the host's opaque key (a folder path). */
export interface SidebarProject {
  id: string;
  name: string;
  /** Absent when the project's settings cannot be read. */
  format?: "latex" | "typst";
  /** Folder path inside My projects, segments joined by "/"; absent at the top level. */
  folder?: string;
  archived?: boolean;
  /** Right-aligned text, like a folder's count. */
  count?: string;
  /** Multi-line `title` attribute. */
  tooltip: string;
}

/** What the Projects section asks the host to do. Folder paths are project folder paths ("" for the top level). */
export interface SidebarProjectActions {
  open(id: string): void;
  /** The host shows its own menu at the pointer. */
  menu(id: string, at: { x: number; y: number }): void;
  browseTemplates(): void;
  newBlank(): void;
  addExisting(): void;
  newFolder(parent: string): void;
  renameFolder(path: string): void;
  deleteFolder(path: string): void;
  refresh(): void;
  closeProject(): void;
  /** A button in a tree pane's header; `action` is the tree's own action id. */
  treeAction(action: string): void;
  treeClick(view: string, key: string): void;
  treeToggle(view: string, key: string, open: boolean): void;
  treeCheck(view: string, key: string, checked: boolean): void;
  treeMenu(view: string, key: string, action: string): void;
  /** Text typed in a row's inline add input; `key` is the row's. */
  treeAdd(view: string, key: string, text: string): void;
}

/** Expansion keys of project folders share the sidebar's expanded set with library folder paths. */
export const projectFolderKey = (path: string): string => `project-folder:${path}`;

// The Explorer's own title actions, in its order: new file, new folder, refresh, collapse all.
export const PROJECT_LIST_ACTIONS =
  `<button class="ls-icon-btn" data-tree="blank" title="New blank project">${icon("new-file")}</button>` +
  `<button class="ls-icon-btn" data-tree="project-folder" title="New folder">${icon("new-folder")}</button>` +
  `<button class="ls-icon-btn" data-tree="project-refresh" title="Refresh">${icon("reload")}</button>` +
  `<button class="ls-icon-btn" data-tree="project-collapse" title="Collapse all">${icon("collapse-all")}</button>`;

const emptyButton = (action: string, label: string, glyph: "plus" | "folder-plus" | "folder-open"): string =>
  `<button class="ls-btn" data-tree="${action}" tabindex="-1">${icon(glyph)}${label}</button>`;

function emptyState(): HTMLElement {
  return el("div", { class: "tree-empty", html: "No projects yet." +
    `<div class="tree-empty-actions">${emptyButton("browse", "Browse templates", "plus")}${emptyButton("blank", "New blank project", "folder-plus")}${emptyButton("add", "Add existing folder", "folder-open")}</div>` });
}

const byName = (a: SidebarProject, b: SidebarProject): number => a.name.localeCompare(b.name);

/** My projects: folders first, then projects, each level sorted by name; a folder's count is every project under it. */
export function projectTreeNodes(projects: readonly SidebarProject[], expanded: ReadonlySet<string>): HTMLElement[] {
  const active = projects.filter((p) => !p.archived);
  if (active.length === 0) return [emptyState()];
  const rows: HTMLElement[] = [];
  const walk = (prefix: string, depth: number): void => {
    const under = active.filter((p) => p.folder !== undefined && (prefix === "" || p.folder.startsWith(`${prefix}/`)));
    const children = [...new Set(under.map((p) => p.folder!.slice(prefix ? prefix.length + 1 : 0).split("/")[0]!))].sort();
    for (const name of children) {
      const path = prefix ? `${prefix}/${name}` : name;
      const open = expanded.has(projectFolderKey(path));
      const count = active.filter((p) => p.folder === path || p.folder?.startsWith(`${path}/`)).length;
      rows.push(projectFolderRow(name, path, { depth, count, open, current: false }));
      if (open) walk(path, depth + 1);
    }
    for (const p of active.filter((q) => (q.folder ?? "") === prefix).sort(byName)) rows.push(projectRow(p, depth));
  };
  walk("", GROUP_ROW_DEPTH);
  return rows;
}

export const archivedNodes = (projects: readonly SidebarProject[]): HTMLElement[] =>
  projects.filter((p) => p.archived).sort(byName).map((p) => projectRow(p, GROUP_ROW_DEPTH));
