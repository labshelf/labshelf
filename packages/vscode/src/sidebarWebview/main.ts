// Mounts the shared library sidebar over the webview messaging API (entry of dist/library/sidebar.js); the extension host answers in ui/library.
import "@labshelf/core/styles/tokens.css";
import "@labshelf/core/styles/vscodeHost.css";
import "@labshelf/core/styles/base.css";
import "@labshelf/core/styles/library-sidebar.css";
import { $, mountLibrarySidebar } from "@labshelf/core/dom";
import type { HostToSidebar, SidebarProjectItem, SidebarToHost } from "../ui/library/sidebarMessages.js";
import { folderDropTarget, showProjectMenu } from "./index.js";

const EXPANDED_KEY = "treeExpanded";
const COLLAPSED_KEY = "collapsedSections";

interface SidebarState { [EXPANDED_KEY]?: string[]; [COLLAPSED_KEY]?: string[] }

const api = acquireVsCodeApi();
const post = (m: SidebarToHost): void => api.postMessage(m);
// setState replaces the whole state, so each save merges into what the other key holds.
const state = (): SidebarState => (api.getState() as SidebarState | undefined) ?? {};
const saveState = (patch: SidebarState): void => api.setState({ ...state(), ...patch });
let projects: SidebarProjectItem[] = [];

const root = $("root");
root.classList.add("sidebar-shell");
const sidebar = mountLibrarySidebar(root.appendChild(document.createElement("div")), {
  actions: {
    openFolder: (path) => { sidebar.setQuery(""); post({ type: "openFolder", path }); },
    searchTag: (tag) => post({ type: "searchTag", tag }),
    revealPaper: (id) => post({ type: "revealPaper", id }),
    createFolder: (path) => post({ type: "createFolder", path }),
    addFiles: (path) => post({ type: "addFiles", path }),
    refresh: () => post({ type: "refresh" }),
    renameFolder: (path) => post({ type: "renameFolder", path }),
    removeFolder: (path) => post({ type: "removeFolder", path }),
  },
  expanded: state()[EXPANDED_KEY] ?? [],
  saveExpanded: (paths) => saveState({ [EXPANDED_KEY]: paths }),
  collapsed: state()[COLLAPSED_KEY] ?? [],
  saveCollapsed: (sections) => saveState({ [COLLAPSED_KEY]: sections }),
  projects: {
    open: (id) => post({ type: "openProject", id }),
    menu: (id, at) => { const project = projects.find((p) => p.id === id); if (project) { showProjectMenu(project, at, post); } },
    browseTemplates: () => post({ type: "projectAction", action: "browseTemplates" }),
    newBlank: () => post({ type: "projectAction", action: "newBlank" }),
    addExisting: () => post({ type: "projectAction", action: "addExisting" }),
  },
  dropTarget: folderDropTarget(post),
});

window.addEventListener("message", (e: MessageEvent<HostToSidebar>) => {
  const m = e.data;
  if (m.type === "library") { sidebar.setLibrary(m.folders, m.papers); }
  else if (m.type === "current") { sidebar.setCurrent(m.folder); }
  else if (m.type === "selected") { sidebar.setSelected(m.id); }
  else if (m.type === "projects") { projects = m.projects; sidebar.setProjects(m.projects); }
});
post({ type: "ready" });
