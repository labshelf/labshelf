// Routes runtime messages from the popup, options, library page and search result buttons to the
// capture/library handlers, gating which message types the search page content script may send.
import { errorMessage, type ILogger } from "@labshelf/core";
import { bx } from "../platform";
import type { LibraryChangedBroadcast, RuntimeMessage, RuntimeResponse } from "../platform";
import { isSearchPageUrl } from "../content";
import type { LibraryMutations } from "../storage";
import {
  handleCaptureAttachPdf, handleCaptureFindPdf, handleCaptureInspect, handleCaptureSave, handleCaptureTab,
  handleFindBetterPdf, handleFindPdfForPaper, handleLibraryFolders, handleLibraryLookup, handleLibraryOpen, handleListTabs,
  handleAskAuthor, handleOpenForPdf, handleRemovePaper, handleSearchHitSave, accessTabDeps,
} from "./handlers/index";
import { handlePdfOfferMessage, isPdfOfferMessage } from "./pdfOffer/index";

// Web pages reach the background only through the search page content script (Scholar and Google),
// and only for what its buttons need; everything else is for extension pages.
const PAGE_MESSAGES: ReadonlySet<RuntimeMessage["type"]> = new Set(["searchHit.save", "library.lookup", "library.folders", "library.open"]);

function allowedFrom(msg: RuntimeMessage, sender: { url?: string }): boolean {
  if (sender.url?.startsWith(bx.runtime.getURL(""))) return true;
  return PAGE_MESSAGES.has(msg?.type) && isSearchPageUrl(sender.url);
}

export interface MessageRouterDeps {
  log: ILogger;
  mutations: LibraryMutations;
}

export function registerMessageRouter(deps: MessageRouterDeps): void {
  bx.runtime.onMessage.addListener(async (message: unknown, sender: { url?: string; tab?: { id?: number } }) => {
    const msg = message as RuntimeMessage;
    // The background's own library.changed broadcast is not a request; if the
    // runtime delivers it back here, ignore it before the exhaustive switch.
    if ((message as LibraryChangedBroadcast | undefined)?.type === "library.changed") return undefined;
    if (!allowedFrom(msg, sender)) {
      void deps.log.log("WARN", "background", "message refused", { type: msg?.type ?? null, from: sender.url ?? null });
      return { ok: false, error: "Not allowed from this page" } satisfies RuntimeResponse;
    }
    try {
      const data = await handle(msg, deps, sender.tab?.id);
      return { ok: true, data } satisfies RuntimeResponse;
    } catch (err: unknown) {
      const error = errorMessage(err);
      void deps.log.error("background", err, { type: msg?.type });
      return { ok: false, error } satisfies RuntimeResponse;
    }
  });
}

async function handle(msg: RuntimeMessage, deps: MessageRouterDeps, senderTabId: number | undefined): Promise<unknown> {
  const { log, mutations } = deps;
  if (isPdfOfferMessage(msg)) return handlePdfOfferMessage({ log, mutations }, msg);
  switch (msg.type) {
    case "capture.inspect":
      return handleCaptureInspect(log, msg);
    case "capture.findPdf":
      return handleCaptureFindPdf(log, msg);
    case "capture.save":
      return handleCaptureSave(log, mutations, msg);
    case "capture.tab":
      return handleCaptureTab(log, mutations, msg);
    case "searchHit.save":
      return handleSearchHitSave(log, mutations, msg, senderTabId);
    case "capture.attachPdf":
      return handleCaptureAttachPdf(log, mutations, msg);
    case "paper.findPdf":
      return msg.replace
        ? handleFindBetterPdf(log, mutations, msg.id)
        : handleFindPdfForPaper(log, mutations, msg.id);
    case "paper.openForPdf":
      return handleOpenForPdf(accessTabDeps(log, mutations), msg);
    case "paper.askAuthor":
      return handleAskAuthor({ log, mutations }, msg.id, senderTabId);
    case "paper.remove":
      return handleRemovePaper(msg.id, mutations, log);
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
