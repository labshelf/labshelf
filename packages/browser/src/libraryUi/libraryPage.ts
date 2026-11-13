// Mounts the browser library workspace with its shared Details pane, and binds the open folder to the URL hash
// (`#/papers/Project/Refs`) so back/forward walk the folder history and a reload lands on the same folder.
import {
  type TabKindName, type NoteViewState, type QmdViewStatePort, TAB_KIND_SPECS, parseTab, createFolderHash, createFolderTitle, deriveParentDir, parseFolderHash, type HostEndpoint, createLoopbackTransport, createSelectionHub, serveAllProjects, type AllProjectsEndpoint, type DetailsToHost, type HostToDetails, type LibraryFileSystem, type ProjectLibraryPort, type SelectionHub,
} from "@labshelf/core";
import { renderElement, mountLibraryUi } from "@labshelf/core/dom";
import type { PaperObjectsPort } from "@labshelf/core/paperObjects";
import { createLazyPaperObjects } from "../paperObjects/lazy";
import { applyTheme, bx, createBrowserLogger, readSettings, watchVisibility } from "../platform";
import { createAiCredentialStore } from "../platform/settings";
import { getBrowserCellPorts } from "../helper";
import { createPageRemoteAccess, type PageRemoteAccess } from "../remoteLibrary";
import { mountMoveOffer, mountSourceBanner } from "../storage/library";
import { createPageRelay, openBrowserRelayAccountStore, type PageRelay } from "../relay";
import { cachePaperRecords, createLibraryFileSystem, createLibraryMutationContext, movePaperNotes } from "../storage";
import { reportPageWrites } from "../collab";
import { attachDetailsReveal, createRightPane, mergeEndpoints, mountPageDetails, PAGE_CAPABILITIES, PAGE_LABELS, splitDetailsChannels } from "./details";
import { attachLibraryHost } from "./host";
import { attachPaperLinkHandling } from "./paperLink";
import { focusCurrentTab, parseLibraryReadQuery } from "./reader";
import { applyCodeStyle, createLocalStoragePrefs } from "./prefs";
import type { ProjectWiring, ProjectWiringOptions } from "./mountProjectWiring";
import { mountSidebarTree, createSidebarSpaces, type SidebarProjectParts } from "./sidebar";
import { createPageSpaces, type PageSpaces } from "./spaces";
import { createSpaceSharingPort } from "./spaceSharing";
import { derivePagePlan, type PagePlan } from "./pagePlan";
import { createPageShell, createWorkspace, extractJoinInvite, JOIN_PREFIX, setPaperTabNames, type ProjectServices, type Workspace } from "./editorArea";

const log = createBrowserLogger();

const NOTE_VIEW_PREFIX = "labshelf.noteView.";

/** Stores each key's state as JSON under `labshelf.noteView.<key>`; a storage error or bad JSON is swallowed, so the view works without persistence. */
export function createLocalNoteViewStore(storage: Pick<Storage, "getItem" | "setItem">): QmdViewStatePort {
  return {
    load: (key) => {
      try {
        const raw = storage.getItem(NOTE_VIEW_PREFIX + key);
        return raw === null ? undefined : (JSON.parse(raw) as unknown);
      } catch { return undefined; }
    },
    save: (key: string, state: NoteViewState) => {
      try { storage.setItem(NOTE_VIEW_PREFIX + key, JSON.stringify(state)); } catch { /* storage unavailable or full: the view keeps its in-memory state */ }
    },
  };
}

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

// Keeps the right pane and the Details selection following the tab in front.
function activateTabHandler(rightPane: ReturnType<typeof createRightPane>, hub: SelectionHub): (id: string) => void {
  return (id) => {
    rightPane.activateTab(id);
    const parsed = parseTab(id);
    const paperId = parsed?.kind === "paper" ? parsed.params["paperId"] : undefined;
    if (paperId) hub.publish("reader", { kind: "paper", ids: [paperId] });
    else if (id === "library") hub.activate("list"); else if (id === "all-projects") hub.activate("projects"); else if (id.startsWith("space:")) hub.activate("spaces");
  };
}

// Papers open as tabs of this workspace: other extension pages call window.labshelfWorkspace (openReader), and a `?read=<id>[&page=<n>]` address
// opens one once the page has loaded, then leaves the address.
function attachReaderOpening(workspace: Workspace): void {
  const openPaper = (paperId: string, page?: number): void => workspace.openTab("paper", { paperId, ...(page === undefined ? {} : { page: String(page) }) });
  window.labshelfWorkspace = {
    async openPaper(paperId, page) {
      openPaper(paperId, page);
      await focusCurrentTab();
    },
  };
  const read = parseLibraryReadQuery(location.search);
  if (!read) return;
  openPaper(read.paperId, read.page);
  const url = new URL(location.href);
  url.searchParams.delete("read");
  url.searchParams.delete("page");
  history.replaceState(history.state, "", url.toString());
}

// A reader framed in the focused paper tab keeps its tab in front; otherwise the Library comes forward.
function revealReaderDetails(shell: ReturnType<typeof createPageShell>, workspace: Workspace, hub: SelectionHub, openTab: (kind: TabKindName) => void): void {
  attachDetailsReveal(shell, (id) => {
    if (!workspace.tabs().some((t) => t.focused && t.id === TAB_KIND_SPECS.paper.id({ paperId: id }))) openTab("library");
    hub.publish("reader", { kind: "paper", ids: [id] });
  });
}

// Opens a project the spaces list names; it is only on this device when the project wiring loaded.
function projectOpener(project: () => ProjectWiring | null): Parameters<typeof createPageSpaces>[0]["openProject"] {
  return async (entry) => {
    const wiring = project();
    if (!wiring) throw new Error(`Project ${entry.settings.id} is not on this device`);
    await wiring.services.session.openProject(entry);
  };
}

// Space sharing runs on the project wiring's share ports, so a page without them shares no Space.
function bindSpaceSharing(spaces: PageSpaces, project: ProjectWiring, libraryHost: ReturnType<typeof attachLibraryHost>): void {
  const { sharing } = project.services;
  if (!sharing.spaceDeps) return;
  spaces.bindSharing(createSpaceSharingPort({
    deps: sharing.spaceDeps, shares: sharing.shares, onShareChange: sharing.onSpaceShareChange, logger: log,
    mutationContext: () => createLibraryMutationContext(log),
    libraryFolders: libraryHost.libraryFolders,
    papersAdded: async (records) => { await cachePaperRecords(records); await libraryHost.reloadSnapshots(); },
    copyText: (text) => libraryHost.sharing.copyText(text),
  }), sharing.shares);
}

// What the page does once everything is mounted.
function finishMount(root: HTMLElement, libraryHost: ReturnType<typeof attachLibraryHost>, spaces: ReturnType<typeof createPageSpaces>): void {
  mountSourceSurfaces(root, async () => { await Promise.all([libraryHost.reloadSnapshots(), spaces.reload()]); });
  attachPaperLinkHandling(log);
  void log.log("INFO", "library", "library page mounted");
}

/** Joins a loaded project to the page: its sharing in the library host and the Spaces, and its projects served to the details pane. */
async function connectProjectSharing(project: ProjectWiring, parts: {
  libraryHost: ReturnType<typeof attachLibraryHost>; spaces: ReturnType<typeof createPageSpaces>;
  details: AllProjectsEndpoint; workspace: Workspace; fs: LibraryFileSystem;
}): Promise<ProjectLibraryPort | null> {
  parts.libraryHost.addProjectSharing(project.projectSharing);
  bindSpaceSharing(parts.spaces, project, parts.libraryHost);
  return serveProjectsToDetails(parts.details, project.services, parts.workspace, parts.fs);
}

/** How often the edits made on /open/ are pulled while Remote access is on. */
const MIRROR_EDITS_PULL_MS = 60_000;

// The Mirror runs once at boot, when the page shows again and when the library changed elsewhere, and the edits made on /open/ are
// pulled every minute; the access keeps one job at a time.
function startMirrorTriggers(remote: PageRemoteAccess): void {
  const run = (): void => { void remote.run(); };
  watchVisibility({ onVisible: run, onMessage: (message) => { if ((message as { type?: unknown } | undefined)?.type === "library.changed") run(); } });
  const pull = setInterval(() => { void remote.pull(); }, MIRROR_EDITS_PULL_MS);
  addEventListener("pagehide", () => { clearInterval(pull); }, { once: true });
  run();
}

/** Mounts the library view without its sidebar, which the page hosts itself. */
function mountLibrary(parts: {
  transport: Awaited<ReturnType<typeof preparePage>>["transport"]; prefs: Awaited<ReturnType<typeof preparePage>>["prefs"];
  sharing: ReturnType<typeof attachLibraryHost>["sharing"]; viewState: ReturnType<typeof createLocalNoteViewStore>;
}): { libraryView: HTMLElement; ui: ReturnType<typeof mountLibraryUi> } {
  const libraryView = renderElement("div", { class: "ls-workspace-fill" });
  const ui = mountLibraryUi(libraryView, { ...parts, withSidebar: false, capabilities: PAGE_CAPABILITIES, labels: PAGE_LABELS });
  return { libraryView, ui };
}

/** The note tabs' From paper… port; its pdf.js and equation code load on the first use. */
function createPagePaperObjects(fs: LibraryFileSystem): PaperObjectsPort {
  return createLazyPaperObjects(() => import("../paperObjects/index.js").then(({ createBrowserPaperObjects }) => createBrowserPaperObjects({
    fs, logger: log, helper: getBrowserCellPorts(log).helper, openHelperSetup: () => { void bx.runtime.openOptionsPage(); }, credentials: createAiCredentialStore(),
  })));
}

/** The right pane's Project chat follows the project's sharing, and a space's chat is the pane's. */
function bindProjectChat(project: ProjectWiring, rightPane: ReturnType<typeof createRightPane>, spaces: PageSpaces, fs: LibraryFileSystem): void {
  rightPane.projectChat.bind({ sharing: project.services.sharing, fs, logger: log });
  spaces.port.projectChat = (projectId) => Promise.resolve(rightPane.projectChat.spaceChat(projectId));
}

async function boot(): Promise<void> {
  const { plan, root, prefs, transport, host, details, fs, shell } = await preparePage();
  void movePaperNotes(fs, log).catch((error: unknown) => log.error("library", error, { op: "movePaperNotes" }));
  const noteViewState = createLocalNoteViewStore(localStorage);
  let project: ProjectWiring | null = null;
  const { relay, relayAccounts } = createRelayParts(() => project);
  const hub = createSelectionHub((target) => details.host.post({ type: "details.show", target }));
  const channels = splitDetailsChannels(details.host, {
    current: hub.current,
    onFolderOpen: (folder) => { host.post({ type: "navigate", folder }); workspace.openTab("library"); },
  });
  let projectsLibrary: ProjectLibraryPort | null = null;
  const spaces = createPageSpaces({ fs, logger: log, transport, selection: hub, workspace: () => workspace, projects: () => projectsLibrary, notes: () => project?.notes,
    openProject: projectOpener(() => project),
  });
  await spaces.reload();
  const libraryHost = attachLibraryHost(mergeEndpoints(host, channels.library), {
    log, spaces, initialPaper: new URLSearchParams(location.search).get("paper"),
    shareRelay: { requireRelay: () => relay.requireBrowserRelay(), connectedRelay: () => relayAccounts.get() },
    onSelection: (ids) => hub.publish("list", ids.length ? { kind: "paper", ids } : null),
    openPaper: async (paperId) => { workspace.openTab("paper", { paperId }); },
    openPaperNotes: (paperId) => { workspace.openTab("paper-notes", { paperId }); },
  });
  const remoteAccess = createPageRemoteAccess({ relayAccounts, sharing: libraryHost.sharing, papers: libraryHost.papers, fs, log });
  startMirrorTriggers(remoteAccess);
  setPaperTabNames(libraryHost.paperTabName);
  attachHashHandlers(host, libraryHost.paperIdAtPath);
  const rightPane = createRightPane(shell, spaces.store);
  const { libraryView, ui } = mountLibrary({ transport, prefs, sharing: libraryHost.sharing, viewState: noteViewState });
  const paperObjects = createPagePaperObjects(fs);
  const projectServices = (): ProjectServices => { if (!project) throw new Error("The project services are not loaded: this page hides Projects"); return project.services; };
  const workspace: Workspace = createWorkspace(shell.centre, {
    prefs: { load: prefs.editorWidth, save: prefs.saveEditorWidth }, logger: log, plan, trailing: rightPane.buttons,
    onActivateTab: activateTabHandler(rightPane, hub),
    services: () => ({ spaces, libraryView, logger: log, fs, prefs, selection: hub, sharing: libraryHost.sharing, toggleProjectChat: () => shell.togglePane("project"), project: projectServices, noteViewState, paperObjects, relay, remote: remoteAccess.remote }),
  });
  const openTab = (kind: TabKindName): void => workspace.openTab(kind);
  const invite = takeInviteOffAddress();
  project = await loadProjectWiring(plan, invite, { workspace, fs, logger: log, openTab, relay, relayAccounts, sharing: libraryHost.sharing, spaces: spaces.shareSpaces() });
  if (project) projectsLibrary = await connectProjectSharing(project, { libraryHost, spaces, details: channels.projects, workspace, fs });
  if (project) bindProjectChat(project, rightPane, spaces, fs);
  mountPageDetails(shell.details, details.ui, prefs);
  const projectParts = plan.projects && project ? sidebarProjectParts(project, relay) : null;
  mountSidebarTree(ui, shell.sidebar, prefs, projectParts, openTab, plan.library, libraryHost.sharing, plan.library ? createSidebarSpaces(spaces, log) : undefined);
  workspace.restore(location.hash);
  attachReaderOpening(workspace);
  revealReaderDetails(shell, workspace, hub, openTab);
  project?.start(invite);
  finishMount(root, libraryHost, spaces);
}

boot().catch((err: unknown) => { void log.error("library", err); });
