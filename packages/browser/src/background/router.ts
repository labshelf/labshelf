// Routes runtime messages from the popup, options, library page and Google Scholar buttons to the
// capture/library handlers, gating which message types a Scholar content script may send.
import { errorMessage, type ILogger } from "@labshelf/core";
import { bx } from "../platform";
import type { LibraryChangedBroadcast, RuntimeMessage, RuntimeResponse } from "../platform";
import { isScholarUrl } from "../content";
import type { LibraryMutations } from "../storage";
import type { createSyncMessages } from "./syncMessages";
import {
  handleCaptureAttachPdf, handleCaptureFindPdf, handleCaptureInspect, handleCaptureSave, handleCaptureTab,
  handleFindBetterPdf, handleFindPdfForPaper, handleLibraryFolders, handleLibraryLookup, handleLibraryOpen, handleListTabs,
  handleOpenForPdf, handleRemovePaper, handleScholarSave, accessTabDeps,
} from "./handlers/index";
import { handlePdfOfferMessage, isPdfOfferMessage } from "./pdfOffer/index";

// Web pages reach the background only through the Scholar content script,
// and only for what its buttons need; everything else is for extension pages.
const PAGE_MESSAGES: ReadonlySet<RuntimeMessage["type"]> = new Set(["scholar.save", "library.lookup", "library.folders", "library.open"]);

function allowedFrom(msg: RuntimeMessage, sender: { url?: string }): boolean {
  if (sender.url?.startsWith(bx.runtime.getURL(""))) return true;
  return PAGE_MESSAGES.has(msg?.type) && isScholarUrl(sender.url);
}

export interface MessageRouterDeps {
  log: ILogger;
  mutations: LibraryMutations;
  syncMessages: ReturnType<typeof createSyncMessages>;
  scheduleSync: (reason: string) => void;
}

export function registerMessageRouter(deps: MessageRouterDeps): void {
  bx.runtime.onMessage.addListener(async (message: unknown, sender: { url?: string }) => {
    const msg = message as RuntimeMessage;
    // The background's own library.changed broadcast is not a request; if the
    // runtime delivers it back here, ignore it before the exhaustive switch.
    if ((message as LibraryChangedBroadcast | undefined)?.type === "library.changed") return undefined;
    if (!allowedFrom(msg, sender)) {
      void deps.log.log("WARN", "background", "message refused", { type: msg?.type ?? null, from: sender.url ?? null });
      return { ok: false, error: "Not allowed from this page" } satisfies RuntimeResponse;
    }
    try {
      const data = await handle(msg, deps);
      return { ok: true, data } satisfies RuntimeResponse;
    } catch (err: unknown) {
      const error = errorMessage(err);
      void deps.log.error("background", err, { type: msg?.type });
      return { ok: false, error } satisfies RuntimeResponse;
    }
  });
}

async function handle(msg: RuntimeMessage, { log, mutations, syncMessages, scheduleSync }: MessageRouterDeps): Promise<unknown> {
  if (isPdfOfferMessage(msg)) return handlePdfOfferMessage({ log, mutations, scheduleSync }, msg);
  switch (msg.type) {
    case "auth.status":
      return syncMessages.authStatus();
    case "auth.connect":
      return syncMessages.connect();
    case "auth.disconnect":
      return syncMessages.disconnect();
    case "sync.status":
      return syncMessages.status();
    case "sync.now":
      return syncMessages.syncNow();
    case "sync.scheduleSoon":
      scheduleSync(msg.reason);
      return { scheduled: true };
    case "capture.inspect":
      return handleCaptureInspect(log, msg);
    case "capture.findPdf":
      return handleCaptureFindPdf(log, msg);
    case "capture.save":
      return handleCaptureSave(log, mutations, msg, scheduleSync);
    case "capture.tab":
      return handleCaptureTab(log, mutations, msg, scheduleSync);
    case "scholar.save":
      return handleScholarSave(log, mutations, msg, scheduleSync);
    case "capture.attachPdf":
      return handleCaptureAttachPdf(log, mutations, msg, scheduleSync);
    case "paper.findPdf":
      return msg.replace
        ? handleFindBetterPdf(log, mutations, msg.id, scheduleSync)
        : handleFindPdfForPaper(log, mutations, msg.id, scheduleSync);
    case "paper.openForPdf":
      return handleOpenForPdf(accessTabDeps(log, mutations, scheduleSync), msg);
    case "paper.remove":
      return handleRemovePaper(msg.id, mutations, log, scheduleSync);
    case "library.folders":
      return handleLibraryFolders();
    case "library.lookup":
      return handleLibraryLookup(msg.items);
    case "library.open":
      return handleLibraryOpen(msg);
    case "tabs.list":
      return handleListTabs();
    default: {
      const exhaustive: never = msg;
      throw new Error(`Unhandled message type: ${JSON.stringify(exhaustive)}`);
    }
  }
}
