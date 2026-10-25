// Mounts the shared library sidebar over the webview messaging API (entry of dist/library/sidebar.js); the extension host answers in ui/library.
import "@labshelf/core/styles/tokens.css";
import "@labshelf/core/styles/vscodeHost.css";
import "@labshelf/core/styles/base.css";
import "@labshelf/core/styles/library-sidebar.css";
import { findElement, mountLibrarySidebar, runShareDialog, type SidebarActions } from "@labshelf/core/dom";
import { isShareMessage, type SidebarProjectItem } from "@labshelf/core";
import type { HostToSidebar, ProjectTreeMessage, SidebarToHost } from "../sidebarMessages.js";
import { createWebviewShareClient } from "../../webview/index.js";
import { createFolderDropZone } from "./folderDropZone.js";
import { showOpenProjectMenu, showProjectMenu } from "./projectMenu.js";

const EXPANDED_KEY = "treeExpanded";
const COLLAPSED_KEY = "collapsedSections";

interface SidebarState { [EXPANDED_KEY]?: string[]; [COLLAPSED_KEY]?: string[] }

const api = acquireVsCodeApi();
const post = (m: SidebarToHost): void => api.postMessage(m);
const sharing = createWebviewShareClient(api);
sharing.onOpen((request) => void runShareDialog(sharing, request));
// setState replaces the whole state, so each save merges into what the other key holds.
const state = (): SidebarState => (api.getState() as SidebarState | undefined) ?? {};
const saveState = (patch: SidebarState): void => api.setState({ ...state(), ...patch });
let projects: SidebarProjectItem[] = [];
let openProjectId: string | null = null;
// The core sidebar names a tree by string; the host checks it is one of its views.
const tree = (m: Omit<ProjectTreeMessage, "type" | "view"> & { view?: string }): void =>
  post({ ...m, type: "projectTree" } as ProjectTreeMessage);

const root = findElement("root");
root.classList.add("sidebar-shell");
const actions: SidebarActions = {
  openFolder: (path) => { sidebar.setQuery(""); post({ type: "openFolder", path }); },
  searchTag: (tag) => post({ type: "searchTag", tag }),
  revealPaper: (id) => post({ type: "revealPaper", id }),
  createFolder: (path) => post({ type: "createFolder", path }),
  addFiles: (path) => post({ type: "addFiles", path }),
  refresh: () => post({ type: "refresh" }),
  renameFolder: (path) => post({ type: "renameFolder", path }),
  removeFolder: (path) => post({ type: "removeFolder", path }),
};
const sidebar = mountLibrarySidebar(root.appendChild(document.createElement("div")), {
  actions,
  sharing,
  expanded: state()[EXPANDED_KEY] ?? [],
  saveExpanded: (paths) => saveState({ [EXPANDED_KEY]: paths }),
  collapsed: state()[COLLAPSED_KEY] ?? [],
  saveCollapsed: (sections) => saveState({ [COLLAPSED_KEY]: sections }),
  projects: {
    open: (id) => post({ type: "openProject", id }),
    menu: (id, at) => { const project = projects.find((p) => p.id === id); if (project) { showProjectMenu(project, at, post, sharing); } },
    browseTemplates: () => post({ type: "projectAction", action: "browseTemplates" }),
    allProjects: () => post({ type: "projectAction", action: "allProjects" }),
    newBlank: () => post({ type: "projectAction", action: "newBlank" }),
    addExisting: () => post({ type: "projectAction", action: "addExisting" }),
    refresh: () => post({ type: "projectAction", action: "refresh" }),
    newFolder: (path) => post({ type: "projectFolder", action: "new", path }),
    renameFolder: (path) => post({ type: "projectFolder", action: "rename", path }),
    deleteFolder: (path) => post({ type: "projectFolder", action: "delete", path }),
    closeProject: () => tree({ op: "close" }),
    openProjectMenu: (anchor) => { const project = projects.find((p) => p.id === openProjectId); if (project) { showOpenProjectMenu(project, anchor, post, sharing); } },
    treeAction: (action) => tree({ op: "action", action }),
    treeClick: (view, key) => tree({ op: "click", view, key }),
    treeToggle: (view, key, open) => tree({ op: "toggle", view, key, open }),
    treeCheck: (view, key, checked) => tree({ op: "check", view, key, checked }),
    treeMenu: (view, key, action) => tree({ op: "menu", view, key, action }),
    treeAdd: (view, key, text) => tree({ op: "add", view, key, text }),
  },
  spaces: {
    openCatalog: () => post({ type: "spaceAction", action: "openCatalog" }),
    openSpace: (id, folder) => post({ type: "spaceAction", action: "openSpace", id, ...(folder ? { folder } : {}) }),
    openPaper: (id) => post({ type: "spaceAction", action: "openPaper", id }),
    newSpace: () => post({ type: "spaceAction", action: "newSpace" }),
    renameSpace: (id) => post({ type: "spaceAction", action: "renameSpace", id }),
    deleteSpace: (id) => post({ type: "spaceAction", action: "deleteSpace", id }),
    newFolder: (spaceId, parent) => post({ type: "spaceAction", action: "newFolder", spaceId, ...(parent ? { parent } : {}) }),
    renameFolder: (spaceId, folder) => post({ type: "spaceAction", action: "renameFolder", spaceId, folder }),
    deleteFolder: (spaceId, folder) => post({ type: "spaceAction", action: "deleteFolder", spaceId, folder }),
    dropPapers: (spaceId, folder, paperIds) => post({ type: "spaceAction", action: "dropPapers", spaceId, paperIds, ...(folder ? { folder } : {}) }),
    removeReference: (spaceId, paperId) => post({ type: "spaceAction", action: "removeReference", spaceId, paperId }),
  },
  dropTarget: createFolderDropZone(post),
});

window.addEventListener("message", (e: MessageEvent<HostToSidebar>) => {
  if (isShareMessage(e.data)) { return; }
  const m = e.data;
  if (m.type === "spaces") { sidebar.setSpaces(m.rows); }
  else if (m.type === "library") { sidebar.setLibrary(m.folders, m.papers); }
  else if (m.type === "current") { sidebar.setCurrent(m.folder); }
  else if (m.type === "selected") { sidebar.setSelected(m.id); }
  else if (m.type === "projects") { projects = m.projects; sidebar.setProjects(m.projects); }
  else if (m.type === "openProject") { openProjectId = m.project?.id ?? null; sidebar.setOpenProject(m.project); }
});
post({ type: "ready" });
