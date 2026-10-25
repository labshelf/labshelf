// Wires the library page to web+labshelf: links: opens a `?link=` target and registers the page as the scheme's handler.
import type { ILogger } from "@labshelf/core";
import { showToast } from "@labshelf/core/dom";
import { bx } from "../../platform";
import { readerUrl } from "../../reader/service";
import { listAllRecords } from "../../storage";
import { openLinkParam } from "./openPaperLinkParam";

const LINK_SCHEME = "web+labshelf";

interface ProtocolRegistration {
  /** True when the manifest declares the handler itself (Firefox `protocol_handlers`). */
  readonly declaredInManifest: boolean;
  readonly handlerUrl: string;
  readonly register: (scheme: string, url: string) => void;
  readonly log: ILogger;
}

/** Never throws: a browser that refuses the registration only loses the click-through. */
export function registerLinkHandler(reg: ProtocolRegistration): void {
  if (reg.declaredInManifest) return;
  try {
    reg.register(LINK_SCHEME, reg.handlerUrl);
  } catch (err) {
    void reg.log.log("WARN", "library-link", "Protocol handler registration failed", {
      scheme: LINK_SCHEME, url: reg.handlerUrl, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
  }
}

/** Opens the page's `?link=` target, then makes sure the browser sends web+labshelf: links here. */
export function attachLinkHandling(log: ILogger): void {
  const handlerUrl = `${bx.runtime.getURL("libraryPage/index.html")}?link=%s`;
  registerLinkHandler({
    declaredInManifest: Boolean((bx.runtime.getManifest() as { protocol_handlers?: unknown }).protocol_handlers),
    handlerUrl,
    register: (scheme, url) => navigator.registerProtocolHandler(scheme, url),
    log,
  });
  void openLinkParam(location.search, {
    listRecords: listAllRecords,
    goToReader: (paperId, page) => location.replace(readerUrl(paperId, page)),
    notifyError: (message) => { showToast(message, "error"); },
    log,
  });
}
