/**
 * Applies the host's messages to an open reader: commands, page jumps, annotation updates and preference changes.
 */
import type { Keyboard } from "../navigation/index.js";
import type { ReaderContext } from "../session/index.js";
import type { ReaderUi } from "./buildReaderUi.js";
import type { DeferredHover } from "./deferredHover.js";

/**
 * Subscribes the open reader to the host messages it acts on.
 */
export function bindHostMessages(ctx: ReaderContext, ui: ReaderUi, keyboard: Keyboard, hover: DeferredHover): void {
  const { host } = ctx;
  host.on("command", (msg) => keyboard.dispatch(msg.id, "host"));
  host.on("scrollToPage", (msg) => ui.goToPage(msg.pageNumber));
  host.on("updateAnnotations", (msg) => ui.annotationsTab.setAnnotations(msg.annotations ?? []));
  host.on("prefsChanged", (msg) => {
    ctx.prefs = msg.prefs;
    ui.toolbar.setAutoHide(msg.prefs.toolbarAutoHide);
    if (!msg.prefs.hoverPreviews) { hover.close(); }
  });
}
