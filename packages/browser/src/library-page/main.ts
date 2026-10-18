/**
 * Bootstraps the library page: mounts the shared library UI with a sidebar slot, answers it through an in-page host over a
 * synchronous loopback channel, and adds the page's own glue (folder tree and projects, URL hash, status bar).
 */
import { createLoopbackTransport } from "@labshelf/core";
import { el, mountLibraryUi } from "@labshelf/core/dom";
import { createBrowserLogger } from "../platform";
import { mountMoveOffer, mountSourceBanner } from "../library-source";
import { createLibraryFileSystem } from "../storage";
import { createBrowserProjects } from "../storage/projects";
import { applyTheme } from "../ui";
import { attachLibraryHost } from "./host";
import { attachLinkHandling } from "./openLink";
import { createLocalStoragePrefs } from "./prefs";
import { createProjectsSource, openEditorInTab, showPdfInTab } from "./projects";
import { attachRouter } from "./router";
import { mountSidebarTree } from "./sidebar";
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

function boot(): void {
  const root = document.getElementById("root");
  if (!root) throw new Error("Missing #root");
  applyTheme();
  const prefs = createLocalStoragePrefs();
  const { ui: transport, host } = createLoopbackTransport();
  // The host listens before the UI mounts, so the UI's ready message finds it. Opened from the popup or a Scholar
  // button, the page selects the paper just saved.
  const libraryHost = attachLibraryHost(host, { log, initialPaper: new URLSearchParams(location.search).get("paper") });
  attachRouter(host);
  const ui = mountLibraryUi(root, {
    transport, prefs, withSidebar: true,
    capabilities: { findPdf: true, attachPdf: true, askAuthor: true },
    labels: {
      addTooltip: "Add a paper from an open tab",
      emptyHint: "Open the paper's page in a tab and use the LabShelf toolbar button, or click Add to pick one of your open tabs.",
    },
  });
  if (ui.sidebar) {
    const fileSystem = createLibraryFileSystem();
    const projects = createProjectsSource({ projects: createBrowserProjects({ fileSystem, logger: log }), fileSystem, logger: log, showPdf: showPdfInTab, openEditor: openEditorInTab });
    mountSidebarTree(ui, ui.sidebar, prefs, host, projects);
  }
  mountSourceSurfaces(root, libraryHost.reloadSnapshots);
  mountStatusBar(root, (listener) => ui.store.select((s) => s.papers.length, listener));
  attachLinkHandling(log);
  void log.log("INFO", "library", "library page mounted");
}

try {
  boot();
} catch (err) {
  void log.error("library", err);
}
