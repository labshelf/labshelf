// Links a build preview to its source: a double-click reports the page point behind it, and a revealed point is scrolled into view and marked.
import { clampPage, type PagePoint } from "../../index.js";
import { DOCUMENT_REPLACED, type ReaderContext } from "../session/index.js";
import { pagePointAt, pixelOffsetOf, type PageViewportLike } from "./pagePoints.js";

// Where the revealed point lands, as a fraction of the container's height from its top.
const REVEAL_POSITION = 1 / 3;
const MARKER_MS = 1600;

interface PageViewLike {
  div: HTMLElement;
  viewport: PageViewportLike;
}

export class SourceSync {
  private marker: HTMLElement | null = null;
  private markerTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly ctx: ReaderContext) {
    ctx.eventBus.on(DOCUMENT_REPLACED, () => this.clearMarker());
    if (ctx.boot.preview) { ctx.container.addEventListener("dblclick", (event) => this.onDoubleClick(event)); }
  }

  /** Scrolls so the point sits about a third from the container's top and marks it for a moment. */
  reveal(point: PagePoint): void {
    const { container, pdfDocument, pdfViewer } = this.ctx;
    const page = clampPage(point.page, pdfDocument.numPages);
    const view = pdfViewer.getPageView(page - 1) as PageViewLike | undefined;
    if (!view?.viewport) { return; }
    const [pixelX, pixelY] = pixelOffsetOf(view.viewport, point);
    const box = container.getBoundingClientRect();
    const pageBox = view.div.getBoundingClientRect();
    // Position inside the scrolled content, which the marker shares because it is a child of the container.
    const x = container.scrollLeft + pageBox.left - box.left + view.div.clientLeft + pixelX;
    const y = container.scrollTop + pageBox.top - box.top + view.div.clientTop + pixelY;
    container.scrollTop = Math.max(0, y - container.clientHeight * REVEAL_POSITION);
    if (x < container.scrollLeft || x > container.scrollLeft + container.clientWidth) {
      container.scrollLeft = Math.max(0, x - container.clientWidth / 2);
    }
    this.showMarker(x, y);
  }

  private onDoubleClick(event: MouseEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    const pageEl = target?.closest<HTMLElement>(".page");
    const page = Number(pageEl?.dataset["pageNumber"]);
    if (!pageEl || !page || target?.closest("a")) { return; }
    const view = this.ctx.pdfViewer.getPageView(page - 1) as PageViewLike | undefined;
    if (!view?.viewport) { return; }
    const box = pageEl.getBoundingClientRect();
    const point = pagePointAt(page, view.viewport, event.clientX - box.left - pageEl.clientLeft, event.clientY - box.top - pageEl.clientTop);
    this.ctx.host.post({ command: "showSource", point });
  }

  private showMarker(x: number, y: number): void {
    this.clearMarker();
    const marker = document.createElement("div");
    marker.className = "rd-sync-marker";
    marker.style.left = `${x}px`;
    marker.style.top = `${y}px`;
    this.ctx.container.appendChild(marker);
    this.marker = marker;
    this.markerTimer = setTimeout(() => this.clearMarker(), MARKER_MS);
  }

  private clearMarker(): void {
    if (this.markerTimer) { clearTimeout(this.markerTimer); }
    this.markerTimer = null;
    this.marker?.remove();
    this.marker = null;
  }
}
