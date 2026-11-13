// Composes the signed-in /open/ page: the LabShelf shell over the Mirror, with Home, the library, Spaces and project files in tabs; edits go back as Mirror edits.
import { createLoopbackTransport, DEFAULT_PREFS, TAB_KIND_SPECS, type ILogger, type SpaceTab } from "@labshelf/core";
import { mountEditorArea, mountHome, mountLibraryUi, mountSpace, mountSpacesCatalog, showToast, type EditorArea, type EditorTab } from "@labshelf/core/dom";

import { loadInto, mountDeckTab, mountPdfTab, mountSourceTab, type FileTabContext } from "./fileTabs.js";
import { createMirrorFileSystem } from "./mirrorFileSystem.js";
import { readMirrorProjects, type MirrorProject } from "./mirrorProjects.js";
import { attachOpenHost } from "./openHost.js";
import { buildRemoteSnapshot, type RemoteIndex } from "./openLibrary.js";
import { createOpenShell } from "./openShell.js";
import { mountOpenSidebar, type OpenSidebar } from "./openSidebar.js";
import { mountNoteFile } from "./noteTab.js";
import { createOpenSpaces } from "./openSpaces.js";
import type { RemoteLibraryClient } from "./remoteClient.js";
import { createBrowserCellPort } from "./runtimes/index.js";
import { closeAllViews, exitFullscreen, showNotes } from "./sourceView.js";

type TabKind = "home" | "spaces" | "library" | "space";

const PAPERS_INDEX = "index/papers.json";
const NO_NOTES_NOTICE = "This paper has no notes in the remote library.";
/** How often the open files are re-checked against the Mirror while the page is visible. */
const RECHECK_MS = 30_000;

const consoleLogger: ILogger = {
  log: async (level, module, message, context) => { if (level === "WARN" || level === "ERROR") { console.warn(`[${module}] ${message}`, context ?? ""); } },
  error: async (module, error, context) => { console.error(`[${module}]`, error, context ?? ""); },
};

const isRemoteIndex = (value: unknown): value is RemoteIndex => {
  const v = value as Partial<RemoteIndex> | null;
  return typeof v === "object" && v !== null && v.version === 1 && Array.isArray(v.folders) && Array.isArray(v.papers);
};

/** A tab of a core kind, with that kind's title and icon unless a title is given. */
function kindTab(kind: TabKind, id: string, mount: EditorTab["mount"], title?: string): EditorTab {
  const spec = TAB_KIND_SPECS[kind];
  return { id, title: title ?? spec.title({}), icon: spec.icon, group: 0, mount };
}

/** A PDF tab; the same name opens the same tab. */
function pdfTab(name: string, load: () => Promise<Uint8Array>): EditorTab {
  return { id: `pdf:${name}`, title: `${name} (PDF)`, icon: "file", group: 0, mount: (el) => mountPdfTab(el, name, load) };
}

/** The tab of a project file: a compiled PDF ready to present, a deck in the share viewer or a source file. */
function fileTab(context: FileTabContext, key: string): EditorTab {
  const { project, fs } = context;
  const output = project.outputs.includes(key);
  const deck = project.decks.includes(key);
  const segments = key.split("/");
  const name = segments[segments.length - 1]!;
  if (output) { return pdfTab(name, () => fs.readFile(key)); }
  return {
    id: `file:${key}`, title: deck ? (segments[segments.length - 2] ?? name) : name, icon: deck ? "file" : "file-text", group: 0,
    mount: (el) => deck ? mountDeckTab(el, key, (path) => fs.readText(path)) : mountSourceTab(el, context, key.slice(`projects/${project.folder}/`.length)),
  };
}

/**
 * Shows the remote library in `root` as the LabShelf interface: the sidebar (Home, Library, Projects, Spaces) and tabs.
 * Every save is an edit of the Mirror's row; dispose sends the waiting edits and drops every tab, view, store, runner and transport.
 */
export async function mountRemoteLibrary(root: HTMLElement, client: RemoteLibraryClient): Promise<{ dispose(): void }> {
  const [rows, papersText] = await Promise.all([client.index(), client.file(PAPERS_INDEX)]);
  const parsed: unknown = JSON.parse(papersText);
  if (!isRemoteIndex(parsed)) { throw new Error("The Mirror's papers index is not readable."); }
  const library = buildRemoteSnapshot(parsed, rows);
  const [projects, fs] = await Promise.all([readMirrorProjects(rows, (path) => client.file(path)), createMirrorFileSystem(rows, client)]);
  const cells = createBrowserCellPort();

  let area: EditorArea | undefined;
  let sidebar: OpenSidebar | undefined;
  const openPdf = (name: string, load: () => Promise<Uint8Array>): void => { area?.open(pdfTab(name, load)); };
  const openNotes = (title: string, path: string): void => {
    area?.open({
      id: `notes:${path}`, title: `${title} (notes)`, icon: "file-text", group: 0,
      mount: (el) => loadInto(el, (body) => { body.classList.add("open-source"); return mountNoteFile(body, { fs, cells, path }); }),
    });
  };
  const openPaper = (id: string): void => {
    const path = library.notePathOf(id);
    if (path === undefined) { showToast(NO_NOTES_NOTICE, "info"); return; }
    const paper = library.snapshot.papers.find((p) => p.id === id);
    showNotes(paper?.title || id, () => fs.readText(path));
  };
  const openHome = (): void => { area?.open(kindTab("home", "home", (el) => spaces.mountTab(el, mountHome))); };
  const openCatalog = (): void => {
    // Creating and deleting Spaces would move folders, which the remote library does not do.
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
  const contextOf = (project: MirrorProject): FileTabContext => ({
    fs, project, cells, logger: consoleLogger, openPdf, papers: async () => library.snapshot.papers,
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
  const detach = attachOpenHost({ fs, rows, library, endpoint: host, openPdf, openNotes });
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
      openFile: (project, key) => area?.open(fileTab(contextOf(project), key)),
    },
  });
  // PLATFORM: pagehide is the last event a closing page reliably gets; the edits waiting for their delay are sent then.
  const flush = (): void => { void fs.flush(); };
  window.addEventListener("pagehide", flush);
  // The open files are re-checked against the Mirror when the page gets focus or becomes visible, and every 30 s while visible.
  const recheck = (): void => { void fs.recheck(); };
  const onVisible = (): void => { if (document.visibilityState === "visible") { recheck(); } };
  window.addEventListener("focus", recheck);
  document.addEventListener("visibilitychange", onVisible);
  const recheckTimer = setInterval(onVisible, RECHECK_MS);
  openHome();
  return {
    dispose: () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(recheckTimer);
      closeAllViews();
      exitFullscreen();
      sidebar?.dispose();
      area?.dispose();
      libraryUi.dispose();
      detach();
      flush();
      cells.dispose();
      root.classList.remove("open-shell");
    },
  };
}
