// Routes runtime messages from the popup, options, library page and search result buttons to the
// capture/library handlers, gating which message types the search page content script may send.
import { formatError, type ILogger } from "@labshelf/core";
import { bx } from "../platform";
import type { LibraryChangedEvent, RuntimeMessage, RuntimeResponse } from "../platform";
import { isSearchPageUrl } from "../content";
import type { LibraryMutations } from "../storage";
import {
  answerCaptureAttachPdf, answerCaptureFindPdf, answerCaptureInspect, answerCaptureWrite, answerCaptureTab,
  answerFindBetterPdf, answerFindPdfForPaper, answerLibraryFolders, answerLibraryFind, answerLibraryOpen, answerListTabs,
  answerOpenForPdf, answerRemovePaper, answerSearchHitWrite, createAccessTabDeps,
} from "./handlers/index";
import { answerCopyRequest } from "./copyRequest";
import { answerPdfOfferMessage, isPdfOfferMessage } from "./import";

// Web pages reach the background only through the search page content script (Scholar and Google),
// and only for what its buttons need; everything else is for extension pages.
const PAGE_MESSAGES: ReadonlySet<RuntimeMessage["type"]> = new Set(["searchHit.save", "library.lookup", "library.folders", "library.open"]);

function allowedFrom(msg: RuntimeMessage, sender: { url?: string }): boolean {
  if (sender.url?.startsWith(bx.runtime.getURL(""))) return true;
  return PAGE_MESSAGES.has(msg?.type) && isSearchPageUrl(sender.url);
}

export interface HandlersDeps {
  log: ILogger;
  mutations: LibraryMutations;
}

export function registerHandlers(deps: HandlersDeps): void {
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
