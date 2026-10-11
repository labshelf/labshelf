/**
 * Maps each keyboard or host ReaderAction to the UI piece that performs it.
 */
import type { ReaderAction } from "../../logic/index.js";
import { closePopover, isPopoverOpen } from "../elements/index.js";
import type { ReaderContext } from "../session/index.js";
import type { ReaderUi } from "./buildReaderUi.js";
import type { DeferredHover } from "./deferredHover.js";

export interface ActionDeps {
  ctx: ReaderContext;
  ui: ReaderUi;
  hover: DeferredHover;
}

/**
 * @returns the function Keyboard calls for every action it resolves.
 */
export function createActionRunner({ ctx, ui, hover }: ActionDeps): (action: ReaderAction) => void {
  const { container, pdfViewer, pdfDocument } = ctx;
  const { goToPage, findBar, zoom, history, pill, sidebar, cheatsheet, bubble } = ui;
  const pageStep = (fraction: number): void => {
    container.scrollBy({ top: container.clientHeight * fraction, behavior: "smooth" });
  };
  return (action) => {
    switch (action) {
      case "pageDown": pageStep(0.9); break;
      case "pageUp": pageStep(-0.9); break;
      case "halfPageDown": pageStep(0.5); break;
      case "halfPageUp": pageStep(-0.5); break;
      case "nextPage": pdfViewer.nextPage(); break;
      case "prevPage": pdfViewer.previousPage(); break;
      case "firstPage": goToPage(1); break;
      case "lastPage": goToPage(pdfDocument.numPages); break;
      case "find": findBar.show(); break;
      case "findNext": findBar.again(false); break;
      case "findPrev": findBar.again(true); break;
      case "zoomIn": zoom.zoomIn(); break;
      case "zoomOut": zoom.zoomOut(); break;
      case "zoomReset": zoom.setPreset(ctx.prefs.defaultZoom); break;
      case "fitWidth": zoom.setPreset("page-width"); break;
      case "fitPage": zoom.setPreset("page-fit"); break;
      case "historyBack": history.back(); break;
      case "historyForward": history.forward(); break;
      case "goToPage": pill.focusPageInput(); break;
      case "toggleSidebar": sidebar.toggle(); break;
      case "cheatsheet": cheatsheet.toggle(); break;
      case "copyWithCitation": bubble.copyWithCitation(); break;
      case "escape": closeInnermost(ui, hover); break;
      // Held-key scrolling is driven by Keyboard itself.
      case "scrollDown": case "scrollUp": case "scrollLeft": case "scrollRight": break;
    }
  };
}

/** Escape closes the innermost transient surface first. */
function closeInnermost(ui: ReaderUi, hover: DeferredHover): void {
  if (ui.cheatsheet.isOpen) { ui.cheatsheet.close(); }
  else if (isPopoverOpen()) { closePopover(); }
  else if (ui.findBar.isOpen) { ui.findBar.close(); }
  else { ui.bubble.hide(); hover.close(); }
}
