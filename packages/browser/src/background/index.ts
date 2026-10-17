// Wires capture and the PDF watcher into the runtime message channel the UI pages use.
// Runs as an MV3 service worker in Chrome and a non-persistent background script in Firefox.
import { bx, createBrowserLogger } from "../platform";
import { createLibraryMutations } from "../storage";
import { forgetDraft } from "./draftCache";
import { registerMessageRouter } from "./router";
import { accessTabDeps } from "./handlers/index";
import { dropWatch, onTabLoaded } from "../capture/index";
import { onDownloadChanged, onPdfTabLoaded, retireTabOffer } from "./pdfOffer/index";

const log = createBrowserLogger();
const MODULE = "background";
const mutations = createLibraryMutations(log);

registerMessageRouter({ log, mutations });

bx.runtime.onInstalled.addListener((details) => {
  void log.log("INFO", MODULE, "extension installed", { reason: details.reason });
});

bx.runtime.onStartup.addListener(() => {
  void log.log("INFO", MODULE, "browser startup");
});

// PLATFORM: registered at the top level, so a service worker that slept while the user signed in wakes for the load.
const accessDeps = accessTabDeps(log, mutations);
bx.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.status !== "complete" || !tab.url) return;
  void onTabLoaded(accessDeps, tabId, tab.url).catch((error: unknown) => log.error(MODULE, error, { op: "onTabLoaded", tabId }));
  void onPdfTabLoaded(log, tabId, tab.url).catch((error: unknown) => log.error(MODULE, error, { op: "onPdfTabLoaded", tabId }));
});

bx.downloads.onChanged.addListener((delta) => {
  void onDownloadChanged(log, delta).catch((error: unknown) => log.error(MODULE, error, { op: "onDownloadChanged", id: delta.id }));
});

bx.tabs.onRemoved.addListener((tabId) => {
  forgetDraft(tabId);
  void dropWatch(tabId).catch((error: unknown) => log.error(MODULE, error, { op: "dropWatch", tabId }));
  void retireTabOffer(log, tabId, true).catch((error: unknown) => log.error(MODULE, error, { op: "retireTabOffer", tabId }));
});
