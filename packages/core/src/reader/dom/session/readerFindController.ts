/**
 * Extends pdf.js' find controller with a scroll step that keeps an already-readable hit in place and parks others below the overlay chrome.
 */
import type { EventBus, PDFFindController, PDFLinkService } from "pdfjs-dist/web/pdf_viewer.mjs" with { "resolution-mode": "import" };
import { decideMatchScroll, freshOrigin, type FindOrigin } from "../../navigation/index.js";
import type { ViewerLib } from "./readerContext.js";

export interface ReaderFind {
  findController: PDFFindController;
  /** Must be called right before a `find` event is dispatched. */
  markFindOrigin(): void;
}

type ScrollMatchArgs = Parameters<PDFFindController["scrollMatchIntoView"]>[0];

/**
 * pdf.js handles a find step in two scrolls: first the hit's page is scrolled to its top, then (once that page's
 * text layer exists) the hit is parked 50px below the container top — underneath this reader's overlay toolbar
 * and find bar. It does both even when the hit was already on screen. So: remember where the reader was when the
 * command was issued, let pdf.js finish, then either go back there (hit was readable) or place the hit properly.
 * @returns the find controller and the hook that records the reader's position before a find command.
 */
export function createReaderFind(
  viewerLib: ViewerLib,
  container: HTMLDivElement,
  linkService: PDFLinkService,
  eventBus: EventBus,
): ReaderFind {
  let findOrigin: FindOrigin | null = null;
  class ReaderFindController extends viewerLib.PDFFindController {
    override scrollMatchIntoView(args: ScrollMatchArgs): void {
      const element = args?.element;
      const startTop = container.scrollTop;
      super.scrollMatchIntoView(args);
      // Unchanged scroll position means pdf.js declined to scroll (not the selected hit).
      if (!element || container.scrollTop === startTop) { return; }
      const origin = freshOrigin(findOrigin, performance.now());
      findOrigin = null;
      const containerTop = container.getBoundingClientRect().top;
      const rect = element.getBoundingClientRect();
      const yNow = rect.top - containerTop;
      // Where the hit sat on screen when the command was issued.
      const shift = origin ? container.scrollTop - origin.top : 0;
      const before = origin ? { top: yNow + shift, bottom: yNow + rect.height + shift } : null;
      const decision = decideMatchScroll(before, container.clientHeight);
      if (decision.kind === "stay" && origin) {
        container.scrollTop = origin.top;
        container.scrollLeft = origin.left;
      } else if (decision.kind === "place") {
        container.scrollTop += yNow - decision.top;
      }
    }
  }
  const findController = new ReaderFindController({ linkService, eventBus, updateMatchesCountOnProgress: true });
  const markFindOrigin = (): void => {
    findOrigin = { top: container.scrollTop, left: container.scrollLeft, at: performance.now() };
  };
  return { findController, markFindOrigin };
}
