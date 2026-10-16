/**
 * Applies the host's messages to an open reader: commands, page jumps, annotation updates, preference changes, and a
 * preview's reloads, build state, logs, revealed source points and citation answers, and changed regions.
 */
import { errorMessage } from "../../../logging/index.js";
import type { PreviewCitations } from "../hover/index.js";
import type { ChangeMarks, Keyboard, SourceSync } from "../navigation/index.js";
import type { DocumentReloader, ReaderContext } from "../session/index.js";
import type { ReaderUi } from "./buildReaderUi.js";
import type { DeferredHover } from "./deferredHover.js";

export interface HostMessageTargets {
  ctx: ReaderContext;
  ui: ReaderUi;
  keyboard: Keyboard;
  hover: DeferredHover;
  reloader: DocumentReloader;
  sourceSync: SourceSync;
  changeMarks: ChangeMarks;
  citations: PreviewCitations;
}

/**
 * Subscribes the open reader to the host messages it acts on.
 */
export function bindHostMessages({ ctx, ui, keyboard, hover, reloader, sourceSync, changeMarks, citations }: HostMessageTargets): void {
  const { host } = ctx;
  host.on("command", (msg) => keyboard.dispatch(msg.id, "host"));
  host.on("scrollToPage", (msg) => ui.goToPage(msg.pageNumber));
  host.on("updateAnnotations", (msg) => ui.annotationsTab.setAnnotations(msg.annotations ?? []));
  host.on("prefsChanged", (msg) => {
    ctx.prefs = msg.prefs;
    ui.toolbar.setAutoHide(msg.prefs.toolbarAutoHide);
    if (!msg.prefs.hoverPreviews) { hover.close(); }
  });
  host.on("reloadDocument", (msg) => {
    // Marks describe the document they came with; marks sent after this request belong to the reloaded one.
    changeMarks.show([]);
    reloader.reload(msg.pdfUrl).then(() => ui.previewChrome?.documentChanged()).catch((err: unknown) => ui.buildBanner.showReloadError(errorMessage(err)));
  });
  // The preview chrome owns the banner: it weighs the build state against the roots.
  host.on("buildStatus", (msg) => ui.previewChrome?.applyBuild(msg.state, msg.errors));
  host.on("previewRoots", (msg) => ui.previewChrome?.applyRoots(msg.roots));
  host.on("showLogs", (msg) => ui.openLogs(msg.root));
  host.on("revealPoint", (msg) => sourceSync.reveal(msg.point));
  host.on("showChanges", (msg) => changeMarks.show(msg.areas));
  host.on("citation", (msg) => citations.lookup.receive(msg.request, msg.entries));
}
