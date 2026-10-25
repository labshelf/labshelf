// Wires capture and the PDF watcher into the runtime message channel the UI pages use.
// Runs as an MV3 service worker in Chrome and a non-persistent background script in Firefox.
import { bx, createBrowserLogger } from "../platform";
import { createLibraryMutations, readLibraryLocation, onPaperRecordsRebuilt, onLibraryFilesChanged, refreshFromFiles } from "../storage";
import { sendLibraryChanged } from "./broadcast";
import { removeTabDraft } from "./draftCache";
import { registerHandlers } from "./registerHandlers";
import { createAccessTabDeps } from "./handlers/index";
import { removeWatch, onTabLoaded } from "../capture/index";
import { onDownloadChanged, onPdfTabLoaded, closeTabOffer } from "./import";

const log = createBrowserLogger();
const MODULE = "background";
const mutations = createLibraryMutations(log);

registerHandlers({ log, mutations });

onLibraryFilesChanged((paths) => {
  void refreshFromFiles(log).then(
    () => sendLibraryChanged("folder"),
    (error: unknown) => log.error(MODULE, error, { op: "rebuildFromFiles", changed: paths.length, first: paths[0] }),
  );
});
onPaperRecordsRebuilt(() => sendLibraryChanged("folder"));
// PLATFORM: a woken service worker has no native port until something opens the link, and changed events need one.
void readLibraryLocation().catch((error: unknown) => log.error(MODULE, error, { op: "openLibraryLink" }));

bx.runtime.onInstalled.addListener((details) => {
  void log.log("INFO", MODULE, "extension installed", { reason: details.reason });
});

bx.runtime.onStartup.addListener(() => {
  void log.log("INFO", MODULE, "browser startup");
});

// PLATFORM: registered at the top level, so a service worker that slept while the user signed in wakes for the load.
const accessDeps = createAccessTabDeps(log, mutations);
bx.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.status !== "complete" || !tab.url) return;
  void onTabLoaded(accessDeps, tabId, tab.url).catch((error: unknown) => log.error(MODULE, error, { op: "onTabLoaded", tabId }));
  void onPdfTabLoaded(log, tabId, tab.url).catch((error: unknown) => log.error(MODULE, error, { op: "onPdfTabLoaded", tabId }));
});

bx.downloads.onChanged.addListener((delta) => {
  void onDownloadChanged(log, delta).catch((error: unknown) => log.error(MODULE, error, { op: "onDownloadChanged", id: delta.id }));
});

bx.tabs.onRemoved.addListener((tabId) => {
  removeTabDraft(tabId);
  void removeWatch(tabId).catch((error: unknown) => log.error(MODULE, error, { op: "dropWatch", tabId }));
  void closeTabOffer(log, tabId, true).catch((error: unknown) => log.error(MODULE, error, { op: "retireTabOffer", tabId }));
});
