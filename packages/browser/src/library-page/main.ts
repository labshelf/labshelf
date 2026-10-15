/**
 * Bootstraps the library page: mounts the shared library UI with a sidebar slot, answers it through an in-page host over a
 * synchronous loopback channel, and adds the page's own glue (folder tree, URL hash, status bar).
 */
import { createLoopbackTransport } from "@labshelf/core";
import { mountLibraryUi } from "@labshelf/core/dom";
import { BrowserLogger } from "../platform";
import { applyTheme } from "../ui";
import { attachLibraryHost } from "./host";
import { createLocalStoragePrefs } from "./prefs";
import { attachRouter } from "./router";
import { mountSidebarTree } from "./sidebar";
import { createSyncStatus, mountStatusBar } from "./statusBar";

const log = new BrowserLogger("library");

function boot(): void {
  const root = document.getElementById("root");
  if (!root) throw new Error("Missing #root");
  applyTheme();
  const prefs = createLocalStoragePrefs();
  const { ui: transport, host } = createLoopbackTransport();
  // The host listens before the UI mounts, so the UI's ready message finds it. Opened from the popup or a Scholar
  // button, the page selects the paper just saved.
  attachLibraryHost(host, { initialPaper: new URLSearchParams(location.search).get("paper") });
  attachRouter(host);
  const ui = mountLibraryUi(root, {
    transport, prefs, withSidebar: true,
    capabilities: { findPdf: true, attachPdf: true },
    labels: {
      addTooltip: "Add a paper from an open tab",
      emptyHint: "Open the paper's page in a tab and use the LabShelf toolbar button, or click Add to pick one of your open tabs.",
    },
  });
  if (ui.sidebar) mountSidebarTree(ui, ui.sidebar, prefs);
  const sync = createSyncStatus();
  mountStatusBar(root, sync, (listener) => ui.store.select((s) => s.papers.length, listener));
  void log.info("library page mounted");
}

try {
  boot();
} catch (err) {
  void log.error("library", err);
}
