// Mounts the browser library workspace with its shared Details pane, and binds the open folder to the URL hash
// (`#/papers/Project/Refs`) so back/forward walk the folder history and a reload lands on the same folder.
import {
  type TabKindName, createFolderHash, createFolderTitle, deriveParentDir, parseFolderHash, type HostEndpoint, createLoopbackTransport, createSelectionHub, serveAllProjects, type AllProjectsEndpoint, type DetailsToHost, type HostToDetails, type LibraryFileSystem, type ProjectLibraryPort,
} from "@labshelf/core";
import { renderElement, mountLibraryUi } from "@labshelf/core/dom";
import { applyTheme, createBrowserLogger, readSettings } from "../platform";
import { mountMoveOffer, mountSourceBanner } from "../storage/library";
import { createPageRelay, openBrowserRelayAccountStore, type PageRelay } from "../relay";
import { createLibraryFileSystem } from "../storage";
import { reportPageWrites } from "../collab";
import { createRightPane, mergeEndpoints, mountPageDetails, PAGE_CAPABILITIES, PAGE_LABELS, splitDetailsChannels } from "./details";
import { attachLibraryHost } from "./host";
import { attachPaperLinkHandling } from "./paperLink";
import { applyCodeStyle, createLocalStoragePrefs } from "./prefs";
import type { ProjectWiring, ProjectWiringOptions } from "./mountProjectWiring";
import { mountSidebarTree, createSidebarSpaces, type SidebarProjectParts } from "./sidebar";
import { createPageSpaces } from "./spaces";
import { derivePagePlan, type PagePlan } from "./pagePlan";
import { createPageShell, createWorkspace, extractJoinInvite, JOIN_PREFIX, type ProjectServices, type Workspace } from "./editorArea";

const log = createBrowserLogger();

/**
 * Starts syncing the UI's folder with location.hash; returns a disposer. A hash that is the path of a paper opens the
 * paper's folder and selects it.
 */
export function attachHashHandlers(endpoint: HostEndpoint, paperIdAtPath: (path: string) => Promise<string | null>): () => void {
  let latest = 0;
  // The folder the UI reports after opening a paper's hash must not replace that hash, so a reload keeps the paper.
  let paperHash: { hash: string; folder: string } | null = null;
  const onHash = async (): Promise<void> => {
    // A tabs hash (`#/tabs/...`) belongs to the workspace and a join hash carries an invite; neither names a folder, so the open folder stays.
    if (location.hash.startsWith("#/tabs/") || location.hash.startsWith(JOIN_PREFIX)) return;
    const hash = location.hash;
    const path = parseFolderHash(hash);
    const turn = ++latest;
    const id = await paperIdAtPath(path);
    if (turn !== latest) return;
    if (!id) { paperHash = null; endpoint.post({ type: "navigate", folder: path }); return; }
    const folder = deriveParentDir(path, "/");
    paperHash = { hash, folder };
    endpoint.post({ type: "navigate", folder });
    endpoint.post({ type: "select", id });
  };
  const run = (): void => { void onHash(); };
  window.addEventListener("hashchange", run);
  const off = endpoint.subscribe((m) => {
    if (m.type === "ready") run();
    if (m.type !== "navigate") return;
    const next = createFolderHash(m.folder);
    const keepsPaperHash = paperHash && location.hash === paperHash.hash && m.folder === paperHash.folder;
    if (location.hash !== next && !keepsPaperHash) history.pushState(null, "", next);
    document.title = createFolderTitle(m.folder);
  });
  return () => { window.removeEventListener("hashchange", run); off(); };
}

/** Puts the storage banner and the move offer above the library frame, which keeps filling the remaining height. */
function mountSourceSurfaces(root: HTMLElement, reloadSnapshots: () => Promise<void>): void {
  const bannerHost = renderElement("div");
  const offerHost = renderElement("div");
  root.prepend(renderElement("div", { class: "lsrc-surfaces" }, bannerHost, offerHost));
  const offer = mountMoveOffer(offerHost, { logger: log, onMoved: reloadSnapshots });
  mountSourceBanner(bannerHost, { logger: log, onFolder: () => { void reloadSnapshots().then(() => offer.refresh()); } });
  void offer.refresh();
}

/** Reads which sidebar sections to show before anything mounts; a failed read shows both. */
async function readPagePlan(): Promise<ReturnType<typeof derivePagePlan>> {
  try {
    return derivePagePlan((await readSettings()).sidebarSections);
  } catch (err) {
    void log.log("WARN", "library", "could not read the sidebar sections; showing both", { error: String(err) });
    return derivePagePlan({ library: true, projects: true });
  }
}

/**
 * Loads the project code only when the page shows Projects or was opened from a share link, so a library-only page never
 * downloads it; a failed load leaves the library working without projects.
 */
async function loadProjectWiring(plan: PagePlan, invite: string | undefined, options: ProjectWiringOptions): Promise<ProjectWiring | null> {
  if (!plan.projects && invite === undefined) return null;
  try {
    return (await import("./mountProjectWiring.js")).mountProjectWiring(options);
  } catch (err) {
    void log.error("library", err, { action: "loadProjectWiring" });
    return null;
  }
}

/** Serves the All projects channel of Details from the same port factory as the All projects tab; a failed load leaves that channel unanswered. */
async function serveProjectsToDetails(endpoint: AllProjectsEndpoint, services: ProjectServices, workspace: Workspace, fs: LibraryFileSystem): Promise<ProjectLibraryPort | null> {
  try {
    const { createPageProjectLibrary } = await import("../writing/index.js");
    const library = createPageProjectLibrary({ fs, logger: log, workspace, session: services.session });
    serveAllProjects(endpoint, library, log);
    return library;
  } catch (err) {
    void log.error("library", err, { action: "serveProjectsToDetails" });
    return null;
  }
}

function sidebarProjectParts(project: ProjectWiring, relay: PageRelay): SidebarProjectParts {
  return { projects: project.sidebarProjects(), manageRelay: () => { void relay.manage(); } };
}

// Share links ask for the relay on a page without projects too, where no shared project takes the relay.
function createRelayParts(project: () => ProjectWiring | null): { relay: PageRelay; relayAccounts: ReturnType<typeof openBrowserRelayAccountStore> } {
  const relay = createPageRelay({
    logger: log,
    offerToShares: async () => { await project()?.offerRelayToShares(); },
    withdrawFromShares: async (relayUrl) => { await project()?.withdrawRelayFromShares(relayUrl); },
  });
  return { relay, relayAccounts: openBrowserRelayAccountStore(log) };
}

// The share key sits in the fragment, so a join link is taken off the address before anything can keep it in history.
function takeInviteOffAddress(): ReturnType<typeof extractJoinInvite> {
  const invite = extractJoinInvite(location.hash);
  if (invite !== undefined) history.replaceState(null, "", location.pathname + location.search);
  return invite;
}

async function preparePage() {
  const plan = await readPagePlan();
  const root = document.getElementById("root");
  if (!root) throw new Error("Missing #root");
  applyTheme();
  const prefs = createLocalStoragePrefs();
  applyCodeStyle(prefs);
  const { ui: transport, host } = createLoopbackTransport();
  const details = createLoopbackTransport<DetailsToHost, HostToDetails>();
  const fs = reportPageWrites(createLibraryFileSystem());
  const shell = createPageShell(root, prefs);
  return { plan, root, prefs, transport, host, details, fs, shell };
}

async function boot(): Promise<void> {
  const { plan, root, prefs, transport, host, details, fs, shell } = await preparePage();
  let project: ProjectWiring | null = null;
  const { relay, relayAccounts } = createRelayParts(() => project);
  const hub = createSelectionHub((target) => details.host.post({ type: "details.show", target }));
  const channels = splitDetailsChannels(details.host, {
    current: hub.current,
    onFolderOpen: (folder) => { host.post({ type: "navigate", folder }); workspace.openTab("library"); },
  });
  let projectsLibrary: ProjectLibraryPort | null = null;
  const spaces = createPageSpaces({ fs, logger: log, transport, selection: hub, workspace: () => workspace, projects: () => projectsLibrary,
    openProject: async entry => {
      if (!project) throw new Error(`Project ${entry.settings.id} is not on this device`);
      await project.services.session.openProject(entry);
    },
  });
  await spaces.reload();
  const libraryHost = attachLibraryHost(mergeEndpoints(host, channels.library), {
    log, spaces, initialPaper: new URLSearchParams(location.search).get("paper"),
    shareRelay: { requireRelay: () => relay.requireBrowserRelay(), connectedRelay: () => relayAccounts.get() },
    onSelection: (ids) => hub.publish("list", ids.length ? { kind: "paper", ids } : null),
  });
  attachHashHandlers(host, libraryHost.paperIdAtPath);
  const rightPane = createRightPane(shell, spaces.store);
  const libraryView = renderElement("div", { class: "ls-workspace-fill" });
  const ui = mountLibraryUi(libraryView, {
    transport, prefs, withSidebar: false,
    capabilities: PAGE_CAPABILITIES, labels: PAGE_LABELS, sharing: libraryHost.sharing,
  });
  const projectServices = (): ProjectServices => { if (!project) throw new Error("The project services are not loaded: this page hides Projects"); return project.services; };
  const workspace: Workspace = createWorkspace(shell.centre, {
    prefs: { load: prefs.editorWidth, save: prefs.saveEditorWidth }, logger: log, plan, trailing: rightPane.buttons,
    onActivateTab: (id) => { rightPane.activateTab(id); if (id === "library") hub.activate("list"); else if (id === "all-projects") hub.activate("projects"); else if (id.startsWith("space:")) hub.activate("spaces"); },
    services: () => ({ spaces, libraryView, logger: log, fs, prefs, selection: hub, sharing: libraryHost.sharing, project: projectServices }),
  });
  const openTab = (kind: TabKindName): void => workspace.openTab(kind);
  const invite = takeInviteOffAddress();
  project = await loadProjectWiring(plan, invite, { workspace, fs, logger: log, openTab, relay, relayAccounts, sharing: libraryHost.sharing });
  if (project) libraryHost.addProjectSharing(project.projectSharing);
  if (project) projectsLibrary = await serveProjectsToDetails(channels.projects, project.services, workspace, fs);
  mountPageDetails(shell.details, details.ui, prefs);
  const projectParts = plan.projects && project ? sidebarProjectParts(project, relay) : null;
  mountSidebarTree(ui, shell.sidebar, prefs, host, projectParts, openTab, plan.library, libraryHost.sharing, plan.library ? createSidebarSpaces(spaces, log) : undefined);
  workspace.restore(location.hash);
  project?.start(invite);
  mountSourceSurfaces(root, async () => { await Promise.all([libraryHost.reloadSnapshots(), spaces.reload()]); });
  attachPaperLinkHandling(log);
  void log.log("INFO", "library", "library page mounted");
}

boot().catch((err: unknown) => { void log.error("library", err); });
