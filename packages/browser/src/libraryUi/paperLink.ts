// Handles web+labshelf: links on the library page: resolves a link's text to a paper and page, opens a `?link=` target and registers the page as the scheme's handler.
import { derivePapersByCiteKey, formatError, parsePaperLink, type ILogger, type PaperRecord } from "@labshelf/core";
import { showToast } from "@labshelf/core/dom";
import { bx } from "../platform";
import { createReaderUrl } from "./readerTabs";
import { listCachedPaperRecords } from "../storage";

// ---- Resolving
export type PaperLinkResolution =
  | { readonly ok: true; readonly paperId: string; readonly page?: number }
  | { readonly ok: false; readonly message: string };

export function resolvePaperLink(text: string, papers: readonly PaperRecord[]): PaperLinkResolution {
  const link = parsePaperLink(text);
  if (!link) return { ok: false, message: `"${text}" is not a LabShelf link.` };
  const paper = derivePapersByCiteKey(papers).get(link.citeKey);
  if (!paper) return { ok: false, message: `No paper in your library has the cite key "${link.citeKey}".` };
  return link.page === undefined ? { ok: true, paperId: paper.id } : { ok: true, paperId: paper.id, page: link.page };
}

// ---- Opening
export interface OpenPaperLinkDeps {
  readonly listRecords: () => Promise<PaperRecord[]>;
  /** Replaces this tab with the reader, so following a link leaves no extra tab. */
  readonly goToReader: (paperId: string, page?: number) => void;
  readonly notifyError: (message: string) => void;
  readonly log: ILogger;
}

export async function openPaperLinkParam(search: string, deps: OpenPaperLinkDeps): Promise<void> {
  const text = new URLSearchParams(search).get("link");
  if (text === null) return;
  try {
    const target = resolvePaperLink(text, await deps.listRecords());
    if (target.ok) {
      deps.goToReader(target.paperId, target.page);
    } else {
      deps.notifyError(target.message);
      void deps.log.log("WARN", "library-link", "Link not opened", { link: text, reason: target.message });
    }
  } catch (err) {
    deps.notifyError(`Could not open the link: ${formatError(err)}`);
    void deps.log.error("library-link", err);
  }
}

// ---- Registering
const LINK_SCHEME = "web+labshelf";

interface ProtocolRegistration {
  /** True when the manifest declares the handler itself (Firefox `protocol_handlers`). */
  readonly declaredInManifest: boolean;
  readonly handlerUrl: string;
  readonly register: (scheme: string, url: string) => void;
  readonly log: ILogger;
}

/** Never throws: a browser that refuses the registration only loses the click-through. */
export function registerPaperLinkHandler(reg: ProtocolRegistration): void {
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
export function attachPaperLinkHandling(log: ILogger): void {
  const handlerUrl = `${bx.runtime.getURL("libraryPage/index.html")}?link=%s`;
  registerPaperLinkHandler({
    declaredInManifest: Boolean((bx.runtime.getManifest() as { protocol_handlers?: unknown }).protocol_handlers),
    handlerUrl,
    register: (scheme, url) => navigator.registerProtocolHandler(scheme, url),
    log,
  });
  void openPaperLinkParam(location.search, {
    listRecords: listCachedPaperRecords,
    goToReader: (paperId, page) => location.replace(createReaderUrl(paperId, page)),
    notifyError: (message) => { showToast(message, "error"); },
    log,
  });
}
