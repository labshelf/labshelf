// The /open/ sidebar: brand and Sign out, then core's Library, Projects and Spaces sections, read-only; every mutating action does nothing.
import { deriveFileIcon, deriveParentDir, deriveSidebarRows, type SidebarOpenProject, type SidebarTreeNode } from "@labshelf/core";
import { mountLibrarySidebar, type LibraryUi } from "@labshelf/core/dom";

import type { MirrorProject } from "./mirrorProjects.js";
import type { OpenSpaces } from "./openSpaces.js";

const ignore = (): void => undefined;

/** What a sidebar click asks the page to open. */
export interface OpenSidebarHooks {
  openLibrary(): void;
  openHome(): void;
  openCatalog(): void;
  openSpace(id: string, folder?: string): void;
  openPaper(id: string): void;
  /** Opens a file row of the open project: a source path, a deck path or a PDF output path. */
  openFile(project: MirrorProject, key: string): void;
}

export interface OpenSidebar {
  /** Shows the project's files under Projects; undefined closes it. */
  showProject(project: MirrorProject | undefined): void;
  dispose(): void;
}

const relative = (project: MirrorProject, path: string): string => path.slice(`projects/${project.folder}/`.length);

function projectTree(project: MirrorProject): SidebarOpenProject {
  const nodes: SidebarTreeNode[] = [
    ...project.outputs.map((o) => ({ key: o.path, label: relative(project, o.path), icon: { kind: "label" as const, text: "PDF", tone: "pdf" as const }, tooltip: "Compiled PDF", clickable: true })),
    ...project.decks.map((d) => ({ key: d, label: relative(project, d), icon: { kind: "glyph" as const, name: "file" as const }, tooltip: "Deck", clickable: true })),
    ...project.files.map((f) => ({ key: `projects/${project.folder}/${f}`, label: f, icon: deriveFileIcon(f), clickable: true })),
  ];
  return {
    id: project.folder, name: project.name, ...(project.format === undefined ? {} : { format: project.format }),
    trees: [{ view: "files", title: "Files", actions: [], nodes, empty: "The remote library holds no files of this project." }],
  };
}

export function mountOpenSidebar(slot: HTMLElement, options: {
  ui: Pick<LibraryUi, "store">; projects: readonly MirrorProject[]; spaces: OpenSpaces; signOut: HTMLElement | null; hooks: OpenSidebarHooks;
}): OpenSidebar {
  const { ui: { store }, projects, spaces, hooks } = options;
  const head = document.createElement("div");
  head.className = "tree-head";
  const brand = document.createElement("span");
  brand.className = "ls-brand";
  brand.textContent = "LabShelf";
  head.append(brand);
  // The page's own Sign out button moves here while the library shows and goes back to the page's bar after.
  const bar = options.signOut?.parentElement ?? null;
  if (options.signOut) { head.append(options.signOut); }
  if (bar) { bar.hidden = true; }
  const treeEl = document.createElement("div");
  slot.replaceChildren(head, treeEl);
  let open: MirrorProject | undefined;
  const byFolder = (id: string) => projects.find((p) => p.folder === id);
  const sidebar = mountLibrarySidebar(treeEl, {
    actions: {
      openFolder: (path) => { hooks.openLibrary(); store.openFolder(path); },
      createFolder: ignore, renameFolder: ignore, removeFolder: ignore,
      searchTag: (tag) => { hooks.openLibrary(); store.searchTag(tag); },
    },
    expanded: [], saveExpanded: ignore, collapsed: [], saveCollapsed: ignore,
    projects: {
      open: (id) => { showProject(byFolder(id)); },
      closeProject: () => { showProject(undefined); },
      treeClick: (_view, key) => { if (open) { hooks.openFile(open, key); } },
      menu: ignore, browseTemplates: ignore, allProjects: ignore, newBlank: ignore, addExisting: ignore, newFolder: ignore, renameFolder: ignore,
      deleteFolder: ignore, refresh: ignore, openProjectMenu: ignore, treeAction: ignore, treeToggle: ignore, treeCheck: ignore, treeMenu: ignore, treeAdd: ignore,
    },
    spaces: {
      readOnly: true, openCatalog: hooks.openCatalog, openHome: hooks.openHome, openSpace: hooks.openSpace, openPaper: hooks.openPaper,
      newSpace: ignore, renameSpace: ignore, trashSpace: ignore, newFolder: ignore, renameFolder: ignore, deleteFolder: ignore, dropPapers: ignore, removeReference: ignore,
    },
  });
  const showProject = (project: MirrorProject | undefined): void => {
    open = project;
    sidebar.setOpenProject(project ? projectTree(project) : null);
  };
  sidebar.setProjectOffers({ templates: false, addExisting: false, newBlank: false, projectFolders: false, allProjects: false });
  sidebar.setProjects(projects.filter((p) => !p.hidden).map((p) => ({ id: p.folder, name: p.name, tooltip: `${p.name}\nRead-only`, ...(p.format === undefined ? {} : { format: p.format }) })));
  sidebar.setSpaces(deriveSidebarRows(spaces.store.list(), spaces.library));
  const offSpaces = spaces.store.onChange(() => sidebar.setSpaces(deriveSidebarRows(spaces.store.list(), spaces.library)));
  // Record paths are papers/<folder>/<id>, so the parent is the tree folder.
  const offLibrary = store.select((s) => ({ folders: s.folders, papers: s.papers }), ({ folders, papers }) =>
    sidebar.setLibrary(folders, papers.map((record) => ({ record, folder: deriveParentDir(record.path, "/") }))));
  const offView = store.select((s) => s.folder, (folder) => sidebar.setCurrent(folder));
  const offQuery = store.select((s) => s.query, (query) => sidebar.setQuery(query));
  return {
    showProject,
    dispose: () => {
      offSpaces(); offLibrary(); offView(); offQuery();
      if (options.signOut && bar) { bar.append(options.signOut); bar.hidden = false; }
    },
  };
}
