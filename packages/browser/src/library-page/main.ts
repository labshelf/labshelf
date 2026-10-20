// Mounts the browser library workspace with its shared Details pane.
import {
  createLoopbackTransport, createSelectionHub, serveAllProjects, type AllProjectsEndpoint, type DetailsToHost, type HostToDetails, type LibraryFileSystem,
} from "@labshelf/core";
import { el, mountLibraryUi } from "@labshelf/core/dom";
import { createBrowserLogger, getSettings } from "../platform";
import { mountMoveOffer, mountSourceBanner } from "../library-source";
import { createLibraryFileSystem } from "../storage";
import { applyTheme } from "../ui";
import { createDetailsToggle, mergeEndpoints, mountPageDetails, PAGE_CAPABILITIES, PAGE_LABELS, splitDetailsChannels } from "./details";
import { attachLibraryHost } from "./host";
import { attachLinkHandling } from "./openLink";
import { applyCodeStyle, createLocalStoragePrefs } from "./prefs";
import { attachRouter } from "./router";
import type { ProjectWiring, ProjectWiringOptions } from "./projectWiring";
import { mountSidebarTree } from "./sidebar";
import { planPage, type PagePlan } from "./sections";
import type { ProjectServices, TabKindName } from "./tabs";
import { createPageShell, createWorkspace, takeJoinInvite, type Workspace } from "./workspace";

const log = createBrowserLogger();

/** Puts the storage banner and the move offer above the library frame, which keeps filling the remaining height. */
function mountSourceSurfaces(root: HTMLElement, reloadSnapshots: () => Promise<void>): void {
  const bannerHost = el("div");
  const offerHost = el("div");
  root.prepend(el("div", { class: "lsrc-surfaces" }, bannerHost, offerHost));
  const offer = mountMoveOffer(offerHost, { logger: log, onMoved: reloadSnapshots });
  mountSourceBanner(bannerHost, { logger: log, onFolder: () => { void reloadSnapshots().then(() => offer.refresh()); } });
  void offer.refresh();
}

/** Reads which sidebar sections to show before anything mounts; a failed read shows both. */
async function readPagePlan(): Promise<ReturnType<typeof planPage>> {
  try {
    return planPage((await getSettings()).sidebarSections);
  } catch (err) {
    void log.log("WARN", "library", "could not read the sidebar sections; showing both", { error: String(err) });
    return planPage({ library: true, projects: true });
  }
}

/**
 * Loads the project code only when the page shows Projects or was opened from a share link, so a library-only page never
 * downloads it; a failed load leaves the library working without projects.
 */
async function loadProjectWiring(plan: PagePlan, invite: string | undefined, options: ProjectWiringOptions): Promise<ProjectWiring | null> {
  if (!plan.projects && invite === undefined) return null;
  try {
    return (await import("./projectWiring/index.js")).mountProjectWiring(options);
  } catch (err) {
    void log.error("library", err, { action: "loadProjectWiring" });
    return null;
  }
}

/** Serves the All projects channel of Details from the same port factory as the All projects tab; a failed load leaves that channel unanswered. */
async function serveProjectsToDetails(endpoint: AllProjectsEndpoint, services: ProjectServices, workspace: Workspace, fs: LibraryFileSystem): Promise<void> {
  try {
    const { createPageProjectLibrary } = await import("./projects-data/index.js");
    serveAllProjects(endpoint, createPageProjectLibrary({ fs, logger: log, workspace, session: services.session }), log);
  } catch (err) {
    void log.error("library", err, { action: "serveProjectsToDetails" });
  }
}

async function boot(): Promise<void> {
  const plan = await readPagePlan();
  const root = document.getElementById("root");
  if (!root) throw new Error("Missing #root");
  applyTheme();
  const prefs = createLocalStoragePrefs();
  applyCodeStyle(prefs);
  const { ui: transport, host } = createLoopbackTransport();
  const details = createLoopbackTransport<DetailsToHost, HostToDetails>();
  const hub = createSelectionHub((target) => details.host.post({ type: "details.show", target }));
  const channels = splitDetailsChannels(details.host, {
    current: hub.current,
    onFolderOpen: (folder) => { host.post({ type: "navigate", folder }); workspace.openTab("library"); },
  });
  const libraryHost = attachLibraryHost(mergeEndpoints(host, channels.library), {
    log, initialPaper: new URLSearchParams(location.search).get("paper"),
    onSelection: (ids) => hub.publish("list", ids.length ? { kind: "paper", ids } : null),
  });
  attachRouter(host, libraryHost.paperIdAtPath);
  const shell = createPageShell(root, prefs);
  const libraryView = el("div", { class: "ls-workspace-fill" });
  const ui = mountLibraryUi(libraryView, {
    transport, prefs, withSidebar: false,
    capabilities: PAGE_CAPABILITIES, labels: PAGE_LABELS,
  });
  const fs = createLibraryFileSystem();
  let project: ProjectWiring | null = null;
  const projectServices = (): ProjectServices => {
    if (!project) throw new Error("The project services are not loaded: this page hides Projects");
    return project.services;
  };
  const workspace: Workspace = createWorkspace(shell.centre, {
    prefs: { load: prefs.editorWidth, save: prefs.saveEditorWidth }, logger: log, plan, trailing: createDetailsToggle(shell),
    onActivateTab: (id) => { if (id === "library") hub.activate("list"); else if (id === "all-projects") hub.activate("projects"); },
    services: () => ({ libraryView, logger: log, fs, prefs, selection: hub, project: projectServices }),
  });
  const openTab = (kind: TabKindName): void => workspace.openTab(kind);
  // The share key sits in the fragment, so a join link is taken off the address before anything can keep it in history.
  const invite = takeJoinInvite(location.hash);
  if (invite !== undefined) history.replaceState(null, "", location.pathname + location.search);
  project = await loadProjectWiring(plan, invite, { workspace, fs, logger: log, openTab });
  if (project) await serveProjectsToDetails(channels.projects, project.services, workspace, fs);
  mountPageDetails(shell.details, details.ui, prefs);
  mountSidebarTree(ui, shell.sidebar, prefs, host, plan.projects && project ? project.sidebarProjects() : null, openTab, plan.library);
  workspace.restore(location.hash);
  project?.start(invite);
  mountSourceSurfaces(root, libraryHost.reloadSnapshots);
  attachLinkHandling(log);
  void log.log("INFO", "library", "library page mounted");
}

boot().catch((err: unknown) => { void log.error("library", err); });
