/**
 * Applies the host's messages to an open reader: commands, page jumps, annotation updates, preference changes, and a
 * preview's reloads, build state, logs, revealed source points and citation answers, and changed regions.
 */
import { formatError } from "../../../errors/index.js";
import type { PreviewCitations } from "../hover/index.js";
import type { ChangeMarks, Keyboard, SourceSync } from "../navigation/index.js";
import type { PdfReloader, ReaderContext } from "../session/index.js";
import type { ReaderUi } from "./buildReaderUi.js";
import type { DeferredHover } from "./deferredHover.js";

export interface HostMessageParts {
  ctx: ReaderContext;
  ui: ReaderUi;
  keyboard: Keyboard;
  hover: DeferredHover;
  reloader: PdfReloader;
  sourceSync: SourceSync;
  changeMarks: ChangeMarks;
  citations: PreviewCitations;
}

/**
 * Subscribes the open reader to the host messages it acts on.
 */
export function attachReaderHostMessages({ ctx, ui, keyboard, hover, reloader, sourceSync, changeMarks, citations }: HostMessageParts): void {
  const { host } = ctx;
  host.on("command", (msg) => keyboard.dispatch(msg.id, "host"));
  host.on("scrollToPage", (msg) => ui.goToPage(msg.pageNumber));
  host.on("updateAnnotations", (msg) => {
    ui.annotationsTab.setAnnotations(msg.annotations ?? []);
    ui.highlights.show(msg.annotations ?? []);
  });
  host.on("prefsChanged", (msg) => {
    ctx.prefs = msg.prefs;
    ui.toolbar.setAutoHide(msg.prefs.toolbarAutoHide);
    if (!msg.prefs.hoverPreviews) { hover.close(); }
  });
  host.on("reloadDocument", (msg) => {
    // Marks describe the document they came with; marks sent after this request belong to the reloaded one.
    changeMarks.show([]);
    reloader.reload(msg.pdfUrl).then(() => ui.previewChrome?.documentChanged()).catch((err: unknown) => ui.buildBanner.showReloadError(formatError(err)));
  });
  // The preview chrome shows the build state in the header and footer.
  host.on("buildStatus", (msg) => ui.previewChrome?.applyBuild(msg));
  host.on("previewRoots", (msg) => ui.previewChrome?.applyRoots(msg.roots));
  host.on("showLogs", (msg) => ui.openLogs(msg.root));
  host.on("revealPoint", (msg) => sourceSync.reveal(msg.point));
  host.on("showChanges", (msg) => changeMarks.show(msg.areas));
  host.on("citation", (msg) => citations.lookup.receive(msg.request, msg.entries));
}
