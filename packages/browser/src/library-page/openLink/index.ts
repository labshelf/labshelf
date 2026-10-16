// Wires the library page to web+labshelf: links: opens a `?link=` target and registers the page as the scheme's handler.
import type { ILogger } from "@labshelf/core";
import { toast } from "@labshelf/core/dom";
import { bx } from "../../platform";
import { readerUrl } from "../../reader/access";
import { listAllRecords } from "../../storage";
import { openLinkParam } from "./openLinkParam";
import { registerLinkHandler } from "./registerProtocolHandler";

/** Opens the page's `?link=` target, then makes sure the browser sends web+labshelf: links here. */
export function attachLinkHandling(log: ILogger): void {
  const handlerUrl = `${bx.runtime.getURL("library-page/index.html")}?link=%s`;
  registerLinkHandler({
    declaredInManifest: Boolean((bx.runtime.getManifest() as { protocol_handlers?: unknown }).protocol_handlers),
    handlerUrl,
    register: (scheme, url) => navigator.registerProtocolHandler(scheme, url),
    log,
  });
  void openLinkParam(location.search, {
    listRecords: listAllRecords,
    goToReader: (paperId, page) => location.replace(readerUrl(paperId, page)),
    notifyError: (message) => { toast(message, "error"); },
    log,
  });
}
