/**
 * Applies the host's messages to an open reader: commands, page jumps, annotation updates, preference changes, and a
 * preview's reloads, build state, revealed source points and citation answers.
 */
import { errorMessage } from "../../../logging/index.js";
import type { PreviewCitations } from "../hover/index.js";
import type { Keyboard, SourceSync } from "../navigation/index.js";
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
  citations: PreviewCitations;
}

/**
 * Subscribes the open reader to the host messages it acts on.
 */
export function bindHostMessages({ ctx, ui, keyboard, hover, reloader, sourceSync, citations }: HostMessageTargets): void {
  const { host } = ctx;
  host.on("command", (msg) => keyboard.dispatch(msg.id, "host"));
  host.on("scrollToPage", (msg) => ui.goToPage(msg.pageNumber));
  host.on("updateAnnotations", (msg) => ui.annotationsTab.setAnnotations(msg.annotations ?? []));
  host.on("prefsChanged", (msg) => {
    ctx.prefs = msg.prefs;
    ui.toolbar.setAutoHide(msg.prefs.toolbarAutoHide);
    if (!msg.prefs.hoverPreviews) { hover.close(); }
  });
  host.on("reloadDocument", () => {
    reloader.reload().catch((err: unknown) => ui.buildBanner.showReloadError(errorMessage(err)));
  });
  host.on("buildStatus", (msg) => ui.buildBanner.show(msg.state, msg.errors));
  host.on("revealPoint", (msg) => sourceSync.reveal(msg.point));
  host.on("citation", (msg) => citations.lookup.receive(msg.request, msg.entries));
}
