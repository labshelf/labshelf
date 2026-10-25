// Builds the Projects section rows: the project folder tree with its projects, or an empty state with the actions the host offers.
import { renderElement } from "../../../ui/dom/index.js";
import { renderIcon } from "../../../ui/index.js";
import type { SidebarProject } from "../../viewModel/index.js";
import { GROUP_ROW_DEPTH, renderProjectFolderRow, renderProjectRow } from "./sidebarRows.js";

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
export const projectFolderKey = (path: string): string => `project-folder:${path}`;

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
      const open = expanded.has(projectFolderKey(path));
      const count = active.filter((p) => p.folder === path || p.folder?.startsWith(`${path}/`)).length;
      rows.push(renderProjectFolderRow(name, path, { depth, count, open, current: false }));
      if (open) walk(path, depth + 1);
    }
    for (const p of active.filter((q) => (q.folder ?? "") === prefix).sort(byName)) rows.push(renderProjectRow(p, depth));
  };
  walk("", GROUP_ROW_DEPTH);
  return rows;
}
