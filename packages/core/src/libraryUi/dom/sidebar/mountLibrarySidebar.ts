// Mounts the Library, Projects and Spaces sidebar sections through host actions.
import { PAPERS_DIR, deriveParentDir, type FolderTreeNode } from "../../../library/index.js";
import { runJoinProjectDialog } from "../../../collab/dom/index.js";
import type { ShareHost } from "../../share/index.js";
import { countLibraryTags, deriveLibraryTree, type TreePaper, type SidebarProject } from "../../viewModel/index.js";
import { createTagQuery } from "../../searchQueries.js";
import { isTreeInput } from "./sidebarTreeInput.js";
import { runTreeRow, onOpenProjectClick, onOpenProjectMenu } from "./sidebarOpenProject.js";
import type { SidebarOpenProject } from "../../sidebarTrees.js";
import {
  ALL_PROJECT_OFFERS,
  createProjectFolderKey,
  type ProjectOffers,
  type SidebarProjectActions,
} from "./sidebarProjects.js";
import { readRowKey } from "./sidebarRows.js";
import type { GroupId, SectionId } from "./sidebarSections.js";
import {
  NAV_ROWS,
  openFolderPath,
  drawFocus,
  render,
  setExpanded,
  updateSectionOpen,
  type SidebarActions,
  type SidebarState,
} from "./sidebarView.js";
import { runSpaceRow, showSpaceMenu, type SidebarSpaceActions, updateSpaceRowOpen } from "./spaces/index.js";
import type { SidebarRow } from "../../../spaces/viewModel/index.js";
import { runImportShareLinkDialog, runManageShareLinksDialog, runShareFolderDialog } from "../../../share/dom/index.js";
import { showMenu, type MenuEntry } from "../../../ui/dom/index.js";

const depthOf = (r: HTMLElement): number => Number(r.style.getPropertyValue("--depth") || 0);

/** The nearest row above `idx` that is one level up: the folder holding the row. */
function parentIndex(rows: HTMLElement[], idx: number): number {
  const depth = depthOf(rows[idx]!);
  for (let i = idx - 1; i >= 0; i--) if ((rows[i]!.dataset["path"] || rows[i]!.dataset["space"]) && depthOf(rows[i]!) < depth) return i;
  return -1;
}

/** Raises the row's right-click event at the row's bottom-left, so the keyboard opens exactly the menu the pointer does. */
function openRowMenu(row: HTMLElement): void {
  const { left, bottom } = row.getBoundingClientRect();
  row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: left, clientY: bottom }));
}

function onSidebarKey(e: KeyboardEvent, t: SidebarState, activate: (row: HTMLElement) => void): void {
  if (e.target instanceof Element && e.target.closest("button, input, select, textarea, a, [contenteditable=true]")) return;
  const rows = Array.from(t.el.querySelectorAll<HTMLElement>(NAV_ROWS));
  if (rows.length === 0) return;
  let idx = t.focused ? rows.findIndex((r) => readRowKey(r) === t.focused) : -1;
  if (idx === -1) idx = Math.max(0, rows.findIndex((r) => r.classList.contains("current") || r.getAttribute("aria-selected") === "true"));
  const current = rows[idx]!;
  const path = current.dataset["path"];
  const open = current.getAttribute("aria-expanded") === "true";
  const section = (current.dataset["section"] ?? current.dataset["group"]) as SectionId | GroupId | undefined;
  const focus = (i: number): void => { t.focused = readRowKey(rows[Math.min(rows.length - 1, Math.max(0, i))]!); };
  if (e.key === "ArrowDown") focus(idx + 1);
  else if (e.key === "ArrowUp") focus(idx - 1);
  else if (e.key === "Home") focus(0);
  else if (e.key === "End") focus(rows.length - 1);
  else if (section && (e.key === "ArrowRight" ? !open : e.key === "ArrowLeft" && open)) updateSectionOpen(t, section);
  else if (current.dataset["space"] && current.hasAttribute("aria-expanded") && ((e.key === "ArrowRight" && !open) || (e.key === "ArrowLeft" && open))) updateSpaceRowOpen(t, current, () => render(t));
  else if (e.key === "ArrowRight") { if (path && current.getAttribute("aria-expanded") === "false") setExpanded(t, path, true); else if (open) focus(idx + 1); }
  else if (e.key === "ArrowLeft") { if (path && open) setExpanded(t, path, false); else { const p = parentIndex(rows, idx); if (p >= 0) focus(p); } }
  else if (e.key === "Enter" || e.key === " ") activate(current);
  else if (e.key === "F2" && path) t.actions.renameFolder(path);
  else if ((e.key === "Delete" || e.key === "Backspace") && path) t.actions.removeFolder(path);
  else if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) openRowMenu(current);
  else return;
  e.preventDefault();
  drawFocus(t);
}

type At = { x: number; y: number };

function showFolderMenu(at: At, actions: SidebarActions, sharing: ShareHost | undefined, path: string, open: () => void): void {
  showMenu(at, [
    { label: "Open", icon: "list", onSelect: open },
    { label: "New Subfolder…", icon: "folder-plus", onSelect: () => actions.createFolder(path) },
    "separator",
    ...(sharing?.offers().links ? [{ label: "Share as Link…", icon: "link" as const, onSelect: () => void runShareFolderDialog(sharing, path) }, "separator" as const] : []),
    { label: "Rename…", icon: "edit", hint: "F2", onSelect: () => actions.renameFolder(path) },
    { label: "Delete Folder…", icon: "trash", danger: true, onSelect: () => actions.removeFolder(path) },
  ]);
}

/** The Library heading's menu; false when the host offers no shared links. */
function libraryHeadingMenu(e: MouseEvent, r: HTMLElement | null, sharing: ShareHost | undefined): boolean {
  if (r?.dataset["section"] !== "library" || !sharing?.offers().links) return false;
  showMenu({ x: e.clientX, y: e.clientY }, [
    { label: "Manage Shared Links…", icon: "link", onSelect: () => void runManageShareLinksDialog(sharing) },
    { label: "Import Shared Link…", icon: "download", onSelect: () => void runImportShareLinkDialog(sharing) },
  ]);
  e.preventDefault();
  return true;
}

/** The menus of a project folder and of the My projects heading; false when the row is neither. */
function projectContextMenu(e: MouseEvent, r: HTMLElement | null, p: SidebarProjectActions, offers: ProjectOffers, sharing: ShareHost | undefined): boolean {
  const folder = r?.dataset["projectFolder"];
  const at = { x: e.clientX, y: e.clientY };
  if (folder !== undefined) {
    if (!offers.projectFolders) return false;
    showMenu(at, [
      { label: "New Subfolder…", icon: "folder-plus", onSelect: () => p.newFolder(folder) },
      "separator",
      { label: "Rename…", icon: "edit", onSelect: () => p.renameFolder(folder) },
      { label: "Delete Folder", icon: "trash", danger: true, onSelect: () => p.deleteFolder(folder) },
    ]);
  } else if (r?.dataset["group"] === "projects.list") {
    const entries: MenuEntry[] = [
      ...(offers.newBlank ? [{ label: "New Blank Project…", icon: "new-file" as const, onSelect: () => p.newBlank() }] : []),
      ...(offers.projectFolders ? [{ label: "New Folder…", icon: "new-folder" as const, onSelect: () => p.newFolder("") }] : []),
      ...(offers.addExisting ? [{ label: "Add Existing Folder…", icon: "folder-open" as const, onSelect: () => p.addExisting() }] : []),
      ...(sharing?.offers().projects ? [{ label: "Join Shared Project…", icon: "link" as const, onSelect: () => void runJoinProjectDialog(sharing) }] : []),
      ...(offers.templates ? ["separator" as const, { label: "Explore Templates", icon: "layers" as const, onSelect: () => p.browseTemplates() }] : []),
    ];
    if (entries.length === 0) return false;
    showMenu(at, entries);
  } else return false;
  e.preventDefault();
  return true;
}

export interface LibrarySidebarOptions {
  actions: SidebarActions;
  expanded: readonly string[];
  saveExpanded(paths: string[]): void;
  /** Ids of the collapsed sections and groups: `library`, `projects`, `spaces`, `library.folders`, `library.tags` or `projects.list`. */
  collapsed: readonly string[];
  saveCollapsed(ids: string[]): void;
  /** Absent → the sidebar has no Projects section. */
  projects?: SidebarProjectActions;
  spaces?: SidebarSpaceActions;
  dropTarget?: (row: HTMLElement, path: string) => void;
  /** Absent → no sharing controls. The sidebar shows the ones the host offers. */
  sharing?: ShareHost;
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
  setSpaces(rows: readonly SidebarRow[]): void;
  setProjects(projects: readonly SidebarProject[]): void;
  /** Leaves out the Projects buttons and menu items whose action the host cannot run; an offer left out stays available. */
  setProjectOffers(offers: Partial<ProjectOffers>): void;
  /** Shows only the open project's trees under Projects; null restores My projects and the gallery row. */
  setOpenProject(project: SidebarOpenProject | null): void;
  /** Folds or unfolds a section or group by id and persists it as a click does; a section already in that state is left alone. */
  setSectionCollapsed(id: SectionId | GroupId, collapsed: boolean): void;
}

const rowAt = (e: Event): HTMLElement | null => (e.target as HTMLElement).closest<HTMLElement>(NAV_ROWS);

/** Opens a project, folder (All papers opens the root) or tag search, reveals a paper or toggles a section or group; a folder or tag is marked at once, before the host answers. */
function activate(t: SidebarState, r: HTMLElement): void {
  const { allPapers, allProjects, id, project, section, group, tag, templates, projectFolder } = r.dataset;
  if (runSpaceRow(t, r, () => render(t))) return;
  if (runTreeRow(t, r, () => render(t))) return;
  if (projectFolder !== undefined) { const key = createProjectFolderKey(projectFolder); setExpanded(t, key, !t.expanded.has(key)); return; }
  if (templates !== undefined) { t.projects?.browseTemplates(); return; }
  if (allProjects !== undefined) { t.projects?.allProjects(); return; }
  const path = allPapers === undefined ? r.dataset["path"] : PAPERS_DIR;
  if (section ?? group) { updateSectionOpen(t, (section ?? group) as SectionId | GroupId); return; }
  if (tag !== undefined) {
    // A second click on the current tag clears its search: an empty tag searches nothing.
    const next = t.query === createTagQuery(tag) ? "" : tag;
    t.query = createTagQuery(next); t.actions.searchTag(next); render(t); return;
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
  if (action === "space-new") { t.spaces?.newSpace(); return; }
  if (action === "new") { t.actions.createFolder(t.target); return; }
  if (action === "add-files") { t.actions.addFiles?.(t.target); return; }
  if (action === "refresh") { t.actions.refresh?.(); return; }
  if (action === "collapse") { t.expanded.clear(); t.saveExpanded([]); render(t); return; }
  if (action === "browse") { t.projects?.browseTemplates(); return; }
  if (action === "blank") { t.projects?.newBlank(); return; }
  if (action === "join" && t.sharing) { void runJoinProjectDialog(t.sharing); return; }
  if (action === "add") { t.projects?.addExisting(); return; }
  if (action === "project-folder") { t.projects?.newFolder(""); return; }
  if (action === "project-refresh") { t.projects?.refresh(); return; }
  if (action === "project-collapse") { for (const key of [...t.expanded]) if (key.startsWith(createProjectFolderKey(""))) t.expanded.delete(key); t.saveExpanded([...t.expanded]); render(t); return; }
  const r = rowAt(e);
  if (!r) return;
  const path = r.dataset["path"];
  t.focused = readRowKey(r);
  if (runSpaceRow(t, r, () => render(t), !!target.closest(".tree-twisty"))) return;
  if (r.dataset["treeKey"] !== undefined && runTreeRow(t, r, () => render(t), !!target.closest(".tree-twisty"))) return;
  if (path && target.closest(".tree-twisty") && r.getAttribute("aria-expanded") !== null) { setExpanded(t, path, !t.expanded.has(path)); return; }
  // Clicking a collapsed parent opens it and expands it, as VS Code does.
  if (path && r.getAttribute("aria-expanded") === "false") t.expanded.add(path);
  activate(t, r);
}

function onContextMenu(e: MouseEvent, t: SidebarState): void {
  const r = rowAt(e);
  if (showSpaceMenu(e, t, r)) return;
  const project = r?.dataset["project"];
  if (project) { e.preventDefault(); t.projects?.menu(project, { x: e.clientX, y: e.clientY }); return; }
  if (libraryHeadingMenu(e, r, t.sharing)) return;
  if (t.projects && projectContextMenu(e, r, t.projects, t.offers, t.sharing)) return;
  if (r && onOpenProjectMenu(e, t, r)) return;
  const path = r?.dataset["path"];
  if (!r || !path) return;
  e.preventDefault();
  t.focused = readRowKey(r);
  drawFocus(t);
  showFolderMenu({ x: e.clientX, y: e.clientY }, t.actions, t.sharing, path, () => activate(t, r));
}

export function mountLibrarySidebar(slot: HTMLElement, o: LibrarySidebarOptions): LibrarySidebar {
  const t: SidebarState = {
    el: slot, actions: o.actions, expanded: new Set(o.expanded), saveExpanded: o.saveExpanded, dropTarget: o.dropTarget, sharing: o.sharing,
    collapsed: new Set(o.collapsed), saveCollapsed: o.saveCollapsed, spaces: o.spaces, spaceList: [], projects: o.projects, projectList: [], offers: ALL_PROJECT_OFFERS, openProject: null, treeOpen: new Map(), treeInput: null,
    focused: null, selectedId: null, current: PAPERS_DIR, target: PAPERS_DIR, tree: null, tags: [], query: "",
  };
  bindSidebar(slot, o, t);
  return {
    setLibrary: (folders, papers) => { t.tree = deriveLibraryTree({ folders, papers }); t.tags = countLibraryTags(papers.map((p) => p.record)); render(t); },
    setQuery: (query) => { t.query = query; render(t); },
    setSpaces: (rows) => { t.spaceList = rows; render(t); },
    setProjects: (projects) => { t.projectList = projects; render(t); },
    setProjectOffers: (offers) => { t.offers = { ...ALL_PROJECT_OFFERS, ...offers }; render(t); },
    setOpenProject: (project) => {
      if (project?.id !== t.openProject?.id) {
        t.treeOpen.clear();
        t.treeInput = null;
      }
      t.openProject = project;
      render(t);
    },
    setSectionCollapsed: (id, collapsed) => { if (t.collapsed.has(id) !== collapsed) updateSectionOpen(t, id); },
    setCurrent: (folder) => { t.current = folder; t.target = folder; openFolderPath(t, deriveParentDir(folder, "/")); render(t); },
    setSelected: (id) => {
      t.selectedId = id;
      const folder = id === null ? undefined : t.tree?.parentOf(id);
      if (folder !== undefined) openFolderPath(t, folder);
      render(t);
    },
  };
}

function bindSidebar(slot: HTMLElement, o: LibrarySidebarOptions, t: SidebarState): void {
  o.sharing?.onOffersChange(() => render(t));
  slot.classList.add("tree");
  slot.setAttribute("role", "tree");
  slot.setAttribute("aria-label", "Library");
  slot.tabIndex = 0;
  slot.addEventListener("click", (e) => onClick(e, t));
  slot.addEventListener("dblclick", (e) => { const path = rowAt(e)?.dataset["path"]; if (path) t.actions.renameFolder(path); });
  slot.addEventListener("contextmenu", (e) => onContextMenu(e, t));
  // A focused button handles Enter and Space itself; row activation would cancel its click.
  const isButton = (target: EventTarget | null): boolean => target instanceof Element && target.closest("button") !== null;
  slot.addEventListener("keydown", (e) => { if (!isTreeInput(e.target) && !isButton(e.target)) onSidebarKey(e, t, (r) => activate(t, r)); });
  slot.addEventListener("focus", () => { t.focused ??= (slot.querySelector<HTMLElement>(".tree-row.current") ?? slot.querySelector<HTMLElement>(NAV_ROWS))?.dataset["key"] ?? null; drawFocus(t); });
  slot.addEventListener("blur", () => { t.focused = null; drawFocus(t); });
}
