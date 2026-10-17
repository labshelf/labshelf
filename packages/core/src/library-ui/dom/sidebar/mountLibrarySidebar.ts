// Mounts the library sidebar: collapsible Library and Projects sections, driven by the host through the returned handle.
import { PAPERS_DIR, parentDir, type FolderTreeNode } from "../../../library/index.js";
import { showMenu } from "../../../ui/dom/index.js";
import { libraryTags, libraryTree, type TreePaper } from "../../derive/index.js";
import { tagQuery } from "../../searchQueries.js";
import { onSidebarKey } from "./sidebarKeys.js";
import { isTreeInput } from "./sidebarTreeInput.js";
import { activateTreeRow, onOpenProjectClick, onOpenProjectMenu } from "./sidebarOpenProject.js";
import type { SidebarOpenProject } from "../../sidebarTrees.js";
import { projectFolderKey, type SidebarProject, type SidebarProjectActions } from "./sidebarProjects.js";
import { rowKey } from "./sidebarRows.js";
import type { GroupId, SectionId } from "./sidebarSections.js";
import { NAV_ROWS, expandTo, paintFocus, render, setExpanded, toggleSection, type SidebarActions, type SidebarState } from "./sidebarView.js";

export interface LibrarySidebarOptions {
  actions: SidebarActions;
  expanded: readonly string[];
  saveExpanded(paths: string[]): void;
  /** Ids of the collapsed sections and groups: `library`, `projects`, `library.folders`, `library.tags` or `projects.list`. */
  collapsed: readonly string[];
  saveCollapsed(ids: string[]): void;
  /** Absent → the sidebar has no Projects section. */
  projects?: SidebarProjectActions;
  dropTarget?: (row: HTMLElement, path: string) => void;
}

/** A paper as the sidebar needs it; `folder` is its tree path (`papers` for the root). */
export interface SidebarPaper { record: TreePaper; folder: string }

export interface LibrarySidebar {
  setLibrary(folders: readonly FolderTreeNode[], papers: readonly SidebarPaper[]): void;
  /** Marks the folder the list shows and expands the folders above it. */
  setCurrent(folder: string): void;
  /** Marks a paper and expands the folders that hold it; null clears the mark. */
  setSelected(id: string | null): void;
  /** Marks the tag row whose search is `query`; any other text clears the mark. */
  setQuery(query: string): void;
  setProjects(projects: readonly SidebarProject[]): void;
  /** Shows only the open project's trees under Projects; null restores My projects and the gallery row. */
  setOpenProject(project: SidebarOpenProject | null): void;
}

const rowAt = (e: Event): HTMLElement | null => (e.target as HTMLElement).closest<HTMLElement>(NAV_ROWS);

/** Opens a project, folder (All papers opens the root) or tag search, reveals a paper or toggles a section or group; a folder or tag is marked at once, before the host answers. */
function activate(t: SidebarState, r: HTMLElement): void {
  const { allPapers, allProjects, id, project, section, group, tag, templates, projectFolder } = r.dataset;
  if (activateTreeRow(t, r, () => render(t))) return;
  if (projectFolder !== undefined) { const key = projectFolderKey(projectFolder); setExpanded(t, key, !t.expanded.has(key)); return; }
  if (templates !== undefined) { t.projects?.browseTemplates(); return; }
  if (allProjects !== undefined) { t.projects?.allProjects(); return; }
  const path = allPapers === undefined ? r.dataset["path"] : PAPERS_DIR;
  if (section ?? group) { toggleSection(t, (section ?? group) as SectionId | GroupId); return; }
  if (tag !== undefined) {
    // A second click on the current tag clears its search: an empty tag searches nothing.
    const next = t.query === tagQuery(tag) ? "" : tag;
    t.query = tagQuery(next); t.actions.searchTag(next); render(t); return;
  }
  if (project) { t.projects?.open(project); return; }
  if (id) { t.target = t.tree?.parentOf(id) ?? PAPERS_DIR; t.actions.revealPaper(id); return; }
  if (path) { t.target = path; t.current = path; t.actions.openFolder(path); }
  render(t);
}

function onClick(e: MouseEvent, t: SidebarState): void {
  const target = e.target as HTMLElement;
  if (isTreeInput(target)) return;
  if (onOpenProjectClick(e, t, () => render(t))) return;
  const action = target.closest<HTMLElement>("[data-tree]")?.dataset["tree"];
  if (action === "new") { t.actions.createFolder(t.target); return; }
  if (action === "add-files") { t.actions.addFiles?.(t.target); return; }
  if (action === "refresh") { t.actions.refresh?.(); return; }
  if (action === "collapse") { t.expanded.clear(); t.saveExpanded([]); render(t); return; }
  if (action === "browse") { t.projects?.browseTemplates(); return; }
  if (action === "blank") { t.projects?.newBlank(); return; }
  if (action === "add") { t.projects?.addExisting(); return; }
  if (action === "project-folder") { t.projects?.newFolder(""); return; }
  if (action === "project-refresh") { t.projects?.refresh(); return; }
  if (action === "project-collapse") { for (const key of [...t.expanded]) if (key.startsWith(projectFolderKey(""))) t.expanded.delete(key); t.saveExpanded([...t.expanded]); render(t); return; }
  const r = rowAt(e);
  if (!r) return;
  const path = r.dataset["path"];
  t.focused = rowKey(r);
  if (r.dataset["treeKey"] !== undefined && activateTreeRow(t, r, () => render(t), !!target.closest(".tree-twisty"))) return;
  if (path && target.closest(".tree-twisty") && r.getAttribute("aria-expanded") !== null) { setExpanded(t, path, !t.expanded.has(path)); return; }
  // Clicking a collapsed parent opens it and expands it, as VS Code does.
  if (path && r.getAttribute("aria-expanded") === "false") t.expanded.add(path);
  activate(t, r);
}

/** The menus of a project folder and of the My projects heading; false when the row is neither. */
function projectContextMenu(e: MouseEvent, r: HTMLElement | null, p: SidebarProjectActions): boolean {
  const folder = r?.dataset["projectFolder"];
  const at = { x: e.clientX, y: e.clientY };
  if (folder !== undefined) {
    showMenu(at, [
      { label: "New Subfolder…", icon: "folder-plus", onSelect: () => p.newFolder(folder) },
      "separator",
      { label: "Rename…", icon: "edit", onSelect: () => p.renameFolder(folder) },
      { label: "Delete Folder", icon: "trash", danger: true, onSelect: () => p.deleteFolder(folder) },
    ]);
  } else if (r?.dataset["group"] === "projects.list") {
    showMenu(at, [
      { label: "New Blank Project…", icon: "new-file", onSelect: () => p.newBlank() },
      { label: "New Folder…", icon: "new-folder", onSelect: () => p.newFolder("") },
      { label: "Add Existing Folder…", icon: "folder-open", onSelect: () => p.addExisting() },
      "separator",
      { label: "Explore Templates", icon: "layers", onSelect: () => p.browseTemplates() },
    ]);
  } else return false;
  e.preventDefault();
  return true;
}

function onContextMenu(e: MouseEvent, t: SidebarState): void {
  const r = rowAt(e);
  const project = r?.dataset["project"];
  if (project) { e.preventDefault(); t.projects?.menu(project, { x: e.clientX, y: e.clientY }); return; }
  if (t.projects && projectContextMenu(e, r, t.projects)) return;
  if (r && onOpenProjectMenu(e, t, r)) return;
  const path = r?.dataset["path"];
  if (!r || !path) return;
  e.preventDefault();
  t.focused = rowKey(r);
  paintFocus(t);
  showMenu({ x: e.clientX, y: e.clientY }, [
    { label: "Open", icon: "list", onSelect: () => activate(t, r) },
    { label: "New Subfolder…", icon: "folder-plus", onSelect: () => t.actions.createFolder(path) },
    "separator",
    { label: "Rename…", icon: "edit", hint: "F2", onSelect: () => t.actions.renameFolder(path) },
    { label: "Delete Folder…", icon: "trash", danger: true, onSelect: () => t.actions.removeFolder(path) },
  ]);
}

export function mountLibrarySidebar(slot: HTMLElement, o: LibrarySidebarOptions): LibrarySidebar {
  const t: SidebarState = {
    el: slot, actions: o.actions, expanded: new Set(o.expanded), saveExpanded: o.saveExpanded, dropTarget: o.dropTarget,
    collapsed: new Set(o.collapsed), saveCollapsed: o.saveCollapsed, projects: o.projects, projectList: [], openProject: null, treeOpen: new Map(), treeInput: null,
    focused: null, selectedId: null, current: PAPERS_DIR, target: PAPERS_DIR, tree: null, tags: [], query: "",
  };
  slot.classList.add("tree");
  slot.setAttribute("role", "tree");
  slot.setAttribute("aria-label", "Library");
  slot.tabIndex = 0;
  slot.addEventListener("click", (e) => onClick(e, t));
  slot.addEventListener("dblclick", (e) => { const path = rowAt(e)?.dataset["path"]; if (path) t.actions.renameFolder(path); });
  slot.addEventListener("contextmenu", (e) => onContextMenu(e, t));
  slot.addEventListener("keydown", (e) => { if (!isTreeInput(e.target)) onSidebarKey(e, t, (r) => activate(t, r)); });
  slot.addEventListener("focus", () => { t.focused ??= slot.querySelector<HTMLElement>(".tree-row.current")?.dataset["key"] ?? null; paintFocus(t); });
  slot.addEventListener("blur", () => { t.focused = null; paintFocus(t); });
  return {
    setLibrary: (folders, papers) => { t.tree = libraryTree({ folders, papers }); t.tags = libraryTags(papers.map((p) => p.record)); render(t); },
    setQuery: (query) => { t.query = query; render(t); },
    setProjects: (projects) => { t.projectList = projects; render(t); },
    setOpenProject: (project) => {
      if (project?.id !== t.openProject?.id) {
        t.treeOpen.clear();
        t.treeInput = null;
      }
      t.openProject = project;
      render(t);
    },
    setCurrent: (folder) => { t.current = folder; t.target = folder; expandTo(t, parentDir(folder, "/")); render(t); },
    setSelected: (id) => {
      t.selectedId = id;
      const folder = id === null ? undefined : t.tree?.parentOf(id);
      if (folder !== undefined) expandTo(t, folder);
      render(t);
    },
  };
}
