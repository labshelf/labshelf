// Marks the regions a host reports as changed over each page, e.g. what differs from an earlier version of a paper.
import type { PageArea } from "../../index.js";
import { DOCUMENT_REPLACED, type ReaderContext } from "../session/index.js";
import { pixelOffsetOf, type PageViewportLike } from "./pagePoints.js";

interface PageViewLike {
  div: HTMLElement;
  viewport: PageViewportLike & { width: number; height: number };
}

const MARK_CLASS = "rd-change-mark";

export class ChangeMarks {
  private byPage = new Map<number, PageArea[]>();

  constructor(private readonly ctx: ReaderContext) {
    // PLATFORM: pdf.js empties a page's element whenever it re-renders it (zoom, rotation, scrolling back into view).
    ctx.eventBus.on("pagerendered", ({ pageNumber }: { pageNumber: number }) => this.drawPage(pageNumber));
    // INVARIANT: a reload request clears the marks first, so marks kept through a replacement arrived for the new document.
    ctx.eventBus.on(DOCUMENT_REPLACED, () => this.redraw());
  }

  /** Replaces the marked regions; an empty list clears them. */
  show(areas: readonly PageArea[]): void {
    const pages = new Set(this.byPage.keys());
    this.byPage = new Map();
    for (const area of areas) {
      this.byPage.set(area.page, [...(this.byPage.get(area.page) ?? []), area]);
      pages.add(area.page);
    }
    for (const page of pages) { this.drawPage(page); }
  }

  private redraw(): void {
    for (const page of this.byPage.keys()) { this.drawPage(page); }
  }

  private drawPage(page: number): void {
    const view = this.ctx.pdfViewer.getPageView(page - 1) as PageViewLike | undefined;
    if (!view?.viewport) { return; }
    for (const old of view.div.querySelectorAll(`.${MARK_CLASS}`)) { old.remove(); }
    for (const area of this.byPage.get(page) ?? []) { view.div.appendChild(markFor(view.viewport, area)); }
  }
}

/** Positioned in percent of the page, so the mark keeps its place while pdf.js scales the page before re-rendering it. */
function markFor(viewport: PageViewLike["viewport"], area: PageArea): HTMLElement {
  const [x1, y1] = pixelOffsetOf(viewport, { page: area.page, x: area.left, y: area.top });
  const [x2, y2] = pixelOffsetOf(viewport, { page: area.page, x: area.right, y: area.bottom });
  const mark = document.createElement("div");
  mark.className = MARK_CLASS;
  mark.style.left = `${(Math.min(x1, x2) / viewport.width) * 100}%`;
  mark.style.top = `${(Math.min(y1, y2) / viewport.height) * 100}%`;
  mark.style.width = `${(Math.abs(x2 - x1) / viewport.width) * 100}%`;
  mark.style.height = `${(Math.abs(y2 - y1) / viewport.height) * 100}%`;
  return mark;
}
