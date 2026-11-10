// Composes the signed-in /open/ page: the LabShelf shell over the Mirror, read-only, with Home, the library, Spaces and project files in tabs.
import { createLoopbackTransport, DEFAULT_PREFS, TAB_KIND_SPECS, type SpaceTab } from "@labshelf/core";
import { mountEditorArea, mountHome, mountLibraryUi, mountSpace, mountSpacesCatalog, showToast, type EditorArea, type EditorTab } from "@labshelf/core/dom";

import { mountDeckTab, mountPdfTab, mountSourceTab } from "./fileTabs.js";
import { createMirrorFileSystem } from "./mirrorFileSystem.js";
import { readMirrorProjects, type MirrorProject } from "./mirrorProjects.js";
import { attachOpenHost } from "./openHost.js";
import { buildRemoteSnapshot, type RemoteIndex } from "./openLibrary.js";
import { createOpenShell } from "./openShell.js";
import { mountOpenSidebar, type OpenSidebar } from "./openSidebar.js";
import { createOpenSpaces } from "./openSpaces.js";
import type { OpenState } from "./remoteClient.js";
import { closeAllViews, exitFullscreen, showNotes } from "./sourceView.js";

type RemoteClient = Extract<OpenState, { kind: "ready" }>["client"];
type TabKind = "home" | "spaces" | "library" | "space";

const PAPERS_INDEX = "index/papers.json";
const NO_NOTES_NOTICE = "This paper has no notes in the remote library, which holds no PDFs.";

const isRemoteIndex = (value: unknown): value is RemoteIndex => {
  const v = value as Partial<RemoteIndex> | null;
  return typeof v === "object" && v !== null && v.version === 1 && Array.isArray(v.folders) && Array.isArray(v.papers);
};

/** A tab of a core kind, with that kind's title and icon unless a title is given. */
function kindTab(kind: TabKind, id: string, mount: EditorTab["mount"], title?: string): EditorTab {
  const spec = TAB_KIND_SPECS[kind];
  return { id, title: title ?? spec.title({}), icon: spec.icon, group: 0, mount };
}

/** The tab of a project file: a compiled PDF ready to present, a deck in the share viewer or a source file. */
function fileTab(project: MirrorProject, key: string, read: (path: string) => Promise<string>): EditorTab {
  const output = project.outputs.find((o) => o.path === key);
  const deck = project.decks.includes(key);
  const segments = key.split("/");
  const name = segments[segments.length - 1]!;
  return {
    id: `file:${key}`, title: output ? `${name} (PDF)` : deck ? (segments[segments.length - 2] ?? name) : name,
    icon: output || deck ? "file" : "file-text", group: 0,
    mount: (el) => output ? mountPdfTab(el, output, read) : deck ? mountDeckTab(el, key, read) : mountSourceTab(el, key, read),
  };
}

/**
 * Shows the remote library read-only in `root` as the LabShelf interface: the sidebar (Home, Library, Projects, Spaces) and tabs.
 * Nothing here asks for a paper PDF or writes to storage; dispose drops every tab, view, store and transport.
 */
export async function mountRemoteLibrary(root: HTMLElement, client: RemoteClient): Promise<{ dispose(): void }> {
  const [rows, papersText] = await Promise.all([client.index(), client.file(PAPERS_INDEX)]);
  const parsed: unknown = JSON.parse(papersText);
  if (!isRemoteIndex(parsed)) { throw new Error("The Mirror's papers index is not readable."); }
  const library = buildRemoteSnapshot(parsed, rows);
  const read = (path: string): Promise<string> => client.file(path);
  const [projects, fs] = await Promise.all([readMirrorProjects(rows, read), createMirrorFileSystem(rows, read)]);

  let area: EditorArea | undefined;
  let sidebar: OpenSidebar | undefined;
  const openPaper = (id: string): void => {
    const path = library.notePathOf(id);
    if (path === undefined) { showToast(NO_NOTES_NOTICE, "info"); return; }
    const paper = library.snapshot.papers.find((p) => p.id === id);
    showNotes(paper?.title || id, () => client.file(path));
  };
  const openHome = (): void => { area?.open(kindTab("home", "home", (el) => spaces.mountTab(el, mountHome))); };
  const openCatalog = (): void => {
    area?.open(kindTab("spaces", "spaces", (el) => spaces.mountTab(el, (host, ui) => mountSpacesCatalog(host, ui, { readOnly: true }))));
  };
  const openSpace = (id: string, tab?: SpaceTab): void => {
    const tabId = `space:${encodeURIComponent(id)}`;
    // An open Space tab keeps its page; asking for a given tab of it opens the Space again on that tab.
    if (tab !== undefined && area?.tabs().some((t) => t.id === tabId)) { void area.close(tabId).then(() => openSpace(id, tab)); return; }
    const found = spaces.store.list().find((r) => r.state === "ready" && r.space.id === id);
    const name = found?.state === "ready" ? found.space.name : undefined;
    area?.open(kindTab("space", tabId, (el) => spaces.mountTab(el, (host, ui) => mountSpace(host, ui, { id, ...(tab ? { tab } : {}) })), name));
  };
  const spaces = await createOpenSpaces({
    fs, papers: library.snapshot.papers, projects,
    hooks: {
      openPaper, openCatalog, openSpace,
      openProject: (projectId) => { sidebar?.showProject(projects.find((p) => p.id === projectId && !p.hidden)); },
    },
  });

  root.replaceChildren();
  root.classList.add("open-shell");
  const shell = createOpenShell(root);
  area = mountEditorArea(shell.centre);
  const libraryHost = document.createElement("div");
  libraryHost.className = "ls-workspace-fill";
  // The library UI lives as long as the page; its tab only shows it, and a closed tab opens again from the sidebar.
  const openLibrary = (): void => {
    area?.open(kindTab("library", "library", (el) => { el.append(libraryHost); return { dispose: () => { libraryHost.remove(); } }; }));
  };
  openLibrary();
  const { ui, host } = createLoopbackTransport();
  // The host listens before the UI mounts, so the UI's ready message finds it.
  const detach = attachOpenHost({ client, library, endpoint: host });
  const libraryUi = mountLibraryUi(libraryHost, {
    transport: ui,
    withSidebar: false,
    // The page keeps nothing, so the list's preferences reset on reload.
    prefs: { load: () => ({ ...DEFAULT_PREFS }), save: () => undefined },
    capabilities: {},
    readOnly: true,
    labels: { addTooltip: "Open LabShelf on your computer to add papers", emptyHint: "The remote library holds no papers." },
  });
  sidebar = mountOpenSidebar(shell.sidebar, {
    ui: libraryUi, projects, spaces, signOut: document.getElementById("open-sign-out"),
    hooks: {
      openPaper, openHome, openCatalog, openSpace: (id, folder) => openSpace(id, folder === undefined ? undefined : "papers"),
      openLibrary,
      openFile: (project, key) => area?.open(fileTab(project, key, read)),
    },
  });
  openHome();
  return {
    dispose: () => {
      closeAllViews();
      exitFullscreen();
      sidebar?.dispose();
      area?.dispose();
      libraryUi.dispose();
      detach();
      root.classList.remove("open-shell");
    },
  };
}
