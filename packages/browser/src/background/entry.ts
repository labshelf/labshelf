// The worker's composition root: wires capture and the PDF watcher into the runtime message channel the UI pages use.
// Runs as an MV3 service worker in Chrome and a non-persistent background script in Firefox.
import { formatError, type ILogger } from "@labshelf/core";
import { bx, createBrowserLogger } from "../platform";
import type { LibraryChangedEvent, RuntimeMessage, RuntimeResponse } from "../platform";
import { isSearchPageUrl } from "../content";
import { createLibraryMutations, readLibraryLocation, onPaperRecordsRebuilt, onLibraryFilesChanged, refreshFromFiles } from "../storage";
import type { LibraryMutations } from "../storage";
import { removeWatch, onTabLoaded } from "../capture/index";
import { sendLibraryChanged } from "./broadcast";
import { removeTabDraft } from "./drafts";
import {
  answerCaptureAttachPdf, answerCaptureFindPdf, answerCaptureInspect, answerCaptureWrite, answerCaptureTab,
  answerFindBetterPdf, answerFindPdfForPaper, answerLibraryFolders, answerLibraryFind, answerLibraryOpen, answerListTabs,
  answerOpenForPdf, answerRemovePaper, answerSearchHitWrite, createAccessTabDeps,
} from "./handlers";
import { answerCopyRequest } from "./copyRequest";
import { answerPdfOfferMessage, isPdfOfferMessage, onDownloadChanged, onPdfTabLoaded, closeTabOffer } from "./offers";

// Web pages reach the background only through the search page content script (Scholar and Google),
// and only for what its buttons need; everything else is for extension pages.
const PAGE_MESSAGES: ReadonlySet<RuntimeMessage["type"]> = new Set(["searchHit.save", "library.lookup", "library.folders", "library.open"]);

function allowedFrom(msg: RuntimeMessage, sender: { url?: string }): boolean {
  if (sender.url?.startsWith(bx.runtime.getURL(""))) return true;
  return PAGE_MESSAGES.has(msg?.type) && isSearchPageUrl(sender.url);
}

interface HandlersDeps {
  log: ILogger;
  mutations: LibraryMutations;
}

function registerHandlers(deps: HandlersDeps): void {
  bx.runtime.onMessage.addListener(async (message: unknown, sender: { url?: string; tab?: { id?: number } }) => {
    const msg = message as RuntimeMessage;
    // The background's own library.changed broadcast is not a request; if the
    // runtime delivers it back here, ignore it before the exhaustive switch.
    if ((message as LibraryChangedEvent | undefined)?.type === "library.changed") return undefined;
    if (!allowedFrom(msg, sender)) {
      void deps.log.log("WARN", "background", "message refused", { type: msg?.type ?? null, from: sender.url ?? null });
      return { ok: false, error: "Not allowed from this page" } satisfies RuntimeResponse;
    }
    try {
      const data = await handle(msg, deps, sender.tab?.id);
      return { ok: true, data } satisfies RuntimeResponse;
    } catch (err: unknown) {
      const error = formatError(err);
      void deps.log.error("background", err, { type: msg?.type });
      return { ok: false, error } satisfies RuntimeResponse;
    }
  });
}

async function handle(msg: RuntimeMessage, deps: HandlersDeps, senderTabId: number | undefined): Promise<unknown> {
  const { log, mutations } = deps;
  if (isPdfOfferMessage(msg)) return answerPdfOfferMessage({ log, mutations }, msg);
  switch (msg.type) {
    case "capture.inspect":
      return answerCaptureInspect(log, msg);
    case "capture.findPdf":
      return answerCaptureFindPdf(log, msg);
    case "capture.save":
      return answerCaptureWrite(log, mutations, msg);
    case "capture.tab":
      return answerCaptureTab(log, mutations, msg);
    case "searchHit.save":
      return answerSearchHitWrite(log, mutations, msg, senderTabId);
    case "capture.attachPdf":
      return answerCaptureAttachPdf(log, mutations, msg);
    case "paper.findPdf":
      return msg.replace
        ? answerFindBetterPdf(log, mutations, msg.id)
        : answerFindPdfForPaper(log, mutations, msg.id);
    case "paper.openForPdf":
      return answerOpenForPdf(createAccessTabDeps(log, mutations), msg);
    case "paper.askAuthor":
      return answerCopyRequest({ log, mutations }, msg.id, senderTabId);
    case "paper.remove":
      return answerRemovePaper(msg.id, mutations, log);
    case "library.folders":
      return answerLibraryFolders();
    case "library.lookup":
      return answerLibraryFind(msg.items);
    case "library.open":
      return answerLibraryOpen(msg);
    case "tabs.list":
      return answerListTabs();
    default: {
      const exhaustive: never = msg;
      throw new Error(`Unhandled message type: ${JSON.stringify(exhaustive)}`);
    }
  }
}

// ----- Worker wiring

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
