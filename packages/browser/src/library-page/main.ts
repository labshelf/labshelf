/**
 * Bootstraps the library page: a page-level sidebar beside a workspace of tabs, the shared library UI as the Library tab
 * (answered by an in-page host over a synchronous loopback channel), and the page's own glue (URL hash, status bar).
 */
import { createLoopbackTransport } from "@labshelf/core";
import { el, mountLibraryUi } from "@labshelf/core/dom";
import { createBrowserLatexHelper } from "../helper/client";
import { createBrowserLogger, getSettings } from "../platform";
import { mountMoveOffer, mountSourceBanner } from "../library-source";
import { createLibraryFileSystem } from "../storage";
import { applyTheme } from "../ui";
import { createPageShares, runJoinDialog } from "./editor/collab";
import { revealInOpenEditor } from "./openEditors";
import { attachLibraryHost } from "./host";
import { createHelperProject } from "./helperProject";
import { attachLinkHandling } from "./openLink";
import { createLocalStoragePrefs } from "./prefs";
import { attachRouter } from "./router";
import type { TabKindName } from "./tabs";
import { createCommentThreads, createRoutedCommentThreads } from "./review";
import { createOpenProjectSnapshot, createProjectSession, resumeRestoredProject } from "./session";
import { loadSidebarProjects, mountSidebarTree } from "./sidebar";
import { planPage } from "./sections";
import { createPageShell, createWorkspace, takeJoinInvite } from "./workspace";
import { mountStatusBar } from "./statusBar";

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

async function boot(): Promise<void> {
  const plan = await readPagePlan();
  const root = document.getElementById("root");
  if (!root) throw new Error("Missing #root");
  applyTheme();
  const prefs = createLocalStoragePrefs();
  const { ui: transport, host } = createLoopbackTransport();
  // The host listens before the UI mounts, so the UI's ready message finds it. Opened from the popup or a Scholar
  // button, the page selects the paper just saved.
  const libraryHost = attachLibraryHost(host, { log, initialPaper: new URLSearchParams(location.search).get("paper") });
  attachRouter(host);
  const shell = createPageShell(root, prefs);
  // Mounted once, detached: the Library tab shows this element and the sidebar follows its store.
  const libraryView = el("div", { class: "ls-workspace-fill" });
  const ui = mountLibraryUi(libraryView, {
    transport, prefs, withSidebar: false,
    capabilities: { findPdf: true, attachPdf: true, askAuthor: true },
    labels: {
      addTooltip: "Add a paper from an open tab",
      emptyHint: "Open the paper's page in a tab and use the LabShelf toolbar button, or click Add to pick one of your open tabs.",
    },
  });
  const fs = createLibraryFileSystem();
  const shares = createPageShares({ fs, logger: log });
  const helperProject = createHelperProject({ helper: createBrowserLatexHelper(log), logger: log });
  const workspace = createWorkspace(shell.centre, {
    prefs: { load: prefs.editorWidth, save: prefs.saveEditorWidth }, logger: log, plan,
    services: () => ({ libraryView, logger: log, fs, prefs, session, helperProject, comments, shares }),
  });
  const session = createProjectSession({
    workspace, snapshot: createOpenProjectSnapshot({ fs, logger: log }), logger: log,
    onProjectChange: helperProject.projectChanged,
    onReveal: (path, line) => {
      const open = session.current();
      if (open?.kind !== "ready") return;
      workspace.openTab("source", { projectId: open.settings.id, path }, 0);
      revealInOpenEditor(open.settings.id, path, line);
    },
  });
  const comments = createRoutedCommentThreads({ files: createCommentThreads({ fs, session, logger: log }), shares, session });
  const openTab = (kind: TabKindName): void => workspace.openTab(kind);
  const joinShared = (invite?: string): Promise<void> => runJoinDialog({ shares, fs, logger: log, session, ...(invite === undefined ? {} : { invite }) });
  const projects = plan.projects ? await loadSidebarProjects(log, fs, session, openTab, () => { void joinShared(); }) : null;
  mountSidebarTree(ui, shell.sidebar, prefs, host, projects, openTab, plan.library);
  // The share key sits in the fragment, so a join link is taken off the address before anything can keep it in history.
  const invite = takeJoinInvite(location.hash);
  if (invite !== undefined) history.replaceState(null, "", location.pathname + location.search);
  workspace.restore(location.hash);
  void resumeRestoredProject(workspace, session, fs, log);
  if (invite !== undefined) void joinShared(invite);
  mountSourceSurfaces(root, libraryHost.reloadSnapshots);
  mountStatusBar(root, (listener) => ui.store.select((s) => s.papers.length, listener));
  attachLinkHandling(log);
  window.addEventListener("pagehide", () => { void shares.closeAll(); });
  void log.log("INFO", "library", "library page mounted");
}

boot().catch((err: unknown) => { void log.error("library", err); });
