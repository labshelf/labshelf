// Builds the outline and thumbnails tabs of the reader sidebar.
import type { RenderTask } from "pdfjs-dist";
import { deriveActiveOutlineRow, deriveOutlineRows, deriveVisibleRows, type OutlineRow, type RawOutlineNode } from "../index.js";
import { DOCUMENT_REPLACED } from "./pdfLoader.js";
import type { ReaderContext } from "./readerSession.js";
import { renderIcon } from "../../ui/index.js";
import { resolveOutlinePages, type SidebarPanel } from "./sidebar.js";
import { renderElement } from "../../ui/dom/index.js";
import type { ThemeController } from "./theme.js";

/**
 * Renders the Outline tab: the PDF's table of contents as a collapsible tree whose active entry follows the current page.
 */

export class OutlineTab implements SidebarPanel {
  readonly el = renderElement("div", { class: "rd-panel rd-outline", role: "tabpanel" });
  private readonly list = renderElement("div", { class: "rd-outline-list", role: "tree" });
  private rows: OutlineRow[] = [];
  private rowPages: Array<number | null> = [];
  private readonly collapsed = new Set<number>();
  private loaded = false;
  private visible = false;

  constructor(private readonly ctx: ReaderContext) {
    this.el.append(renderElement("div", { class: "rd-panel-header" }, renderElement("span", {}, "Outline")), this.list);
    ctx.eventBus.on("pagechanging", () => { if (this.visible) { this.highlightActive(); } });
    ctx.eventBus.on(DOCUMENT_REPLACED, () => this.forget());
  }

  /**
   * Loads the outline on first show and re-highlights the active entry on later shows.
   */
  onShow(): void {
    this.visible = true;
    if (!this.loaded) { void this.load(); } else { this.highlightActive(); }
  }

  onHide(): void { this.visible = false; }

  private forget(): void {
    this.loaded = false;
    this.rows = [];
    this.rowPages = [];
    this.collapsed.clear();
    if (this.visible) { void this.load(); } else { this.list.replaceChildren(); }
  }

  private async load(): Promise<void> {
    this.loaded = true;
    const doc = this.ctx.pdfDocument;
    let raw: RawOutlineNode[] | null = null;
    try {
      raw = (await doc.getOutline()) as RawOutlineNode[] | null;
    } catch {
      raw = null;
    }
    // A reload during the read loads the new outline itself.
    if (doc !== this.ctx.pdfDocument) { return; }
    this.rows = deriveOutlineRows(raw);
    // Deep outlines open collapsed past the second level so the structure is scannable.
    for (const row of this.rows) {
      if (row.hasChildren && row.depth >= 1 && this.rows.length > 40) { this.collapsed.add(row.id); }
    }
    this.rowPages = this.rows.map(() => null);
    this.render();
    void this.resolvePages();
  }

  /** Destinations resolve to page numbers lazily; active-entry tracking sharpens as they arrive. */
  private async resolvePages(): Promise<void> {
    const doc = this.ctx.pdfDocument;
    const pages = await resolveOutlinePages(doc, this.rows, () => doc === this.ctx.pdfDocument);
    if (doc !== this.ctx.pdfDocument) { return; }
    this.rowPages = pages;
    this.render();
  }

  private render(): void {
    if (this.rows.length === 0) {
      this.list.replaceChildren(renderElement("div", { class: "rd-empty" }, "This PDF has no outline."));
      return;
    }
    const frag = document.createDocumentFragment();
    for (const row of deriveVisibleRows(this.rows, this.collapsed)) {
      const isCollapsed = this.collapsed.has(row.id);
      const twisty = renderElement("span", {
        class: `rd-twisty${row.hasChildren ? "" : " rd-twisty-leaf"}`,
        html: row.hasChildren ? renderIcon(isCollapsed ? "chevron-right" : "chevron-down") : "",
      });
      if (row.hasChildren) {
        twisty.addEventListener("click", (e) => {
          e.stopPropagation();
          if (isCollapsed) { this.collapsed.delete(row.id); } else { this.collapsed.add(row.id); }
          this.render();
        });
      }
      const page = this.rowPages[row.id];
      const item = renderElement(
        "div",
        {
          class: `rd-outline-item${row.bold ? " rd-outline-bold" : ""}`,
          role: "treeitem",
          tabindex: 0,
          "data-row": row.id,
          style: `padding-left:${8 + row.depth * 14}px`,
          title: row.title,
          ...(row.hasChildren ? { "aria-expanded": isCollapsed ? "false" : "true" } : {}),
        },
        twisty,
        renderElement("span", { class: "rd-outline-title" }, row.title),
        page ? renderElement("span", { class: "rd-outline-page" }, String(page)) : null,
      );
      const go = (): void => this.activate(row);
      item.addEventListener("click", go);
      item.addEventListener("keydown", (e) => { if (e.key === "Enter") { go(); } });
      frag.append(item);
    }
    this.list.replaceChildren(frag);
    this.highlightActive();
  }

  private activate(row: OutlineRow): void {
    if (row.dest) {
      // Goes through the link service so the jump is recorded in the back/forward history.
      void this.ctx.linkService.goToDestination(row.dest as Parameters<ReaderContext["linkService"]["goToDestination"]>[0]);
    } else if (row.url) {
      this.ctx.host.post({ command: "openExternalLink", url: row.url });
    }
  }

  private highlightActive(): void {
    let active = deriveActiveOutlineRow(this.rowPages, this.ctx.pdfViewer.currentPageNumber);
    // Under a collapsed parent the nearest visible ancestor stands in for the active entry.
    while (active >= 0 && !this.list.querySelector(`[data-row="${active}"]`)) {
      active = this.rows[active]?.parentId ?? -1;
    }
    for (const el of this.list.querySelectorAll<HTMLElement>(".rd-outline-item")) {
      el.classList.toggle("rd-active", Number(el.dataset["row"]) === active);
    }
    this.list.querySelector<HTMLElement>(".rd-active")?.scrollIntoView({ block: "nearest" });
  }
}

/**
 * Renders the Thumbnails tab lazily: placeholders for every page, canvases only for the ones on screen.
 * PLATFORM: pdf.js' own thumbnail viewer is not exported from pdf_viewer.mjs.
 */

const THUMB_CSS_WIDTH = 132;
const MAX_CONCURRENT = 2;
// retainContextWhenHidden keeps this webview alive; release canvases once the tab has been out of sight for a while.
const TEARDOWN_AFTER_HIDDEN_MS = 60_000;

interface Thumb {
  pageNumber: number;
  el: HTMLElement;
  frame: HTMLElement;
  state: "idle" | "queued" | "rendering" | "done";
  task: RenderTask | null;
}

export class ThumbnailsTab implements SidebarPanel {
  readonly el = renderElement("div", { class: "rd-panel rd-thumbs", role: "tabpanel" });
  private readonly list = renderElement("div", { class: "rd-thumb-list" });
  private readonly thumbs: Thumb[] = [];
  private readonly queue: Thumb[] = [];
  private running = 0;
  private built = false;
  private visible = false;
  private observer: IntersectionObserver | null = null;
  private teardownTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly ctx: ReaderContext,
    private readonly theme: ThemeController,
    private readonly goToPage: (page: number) => void,
  ) {
    this.el.append(this.list);
    ctx.eventBus.on("pagechanging", () => { if (this.visible) { this.markCurrent(true); } });
    theme.onPageColorsChange(() => this.reset());
    ctx.eventBus.on(DOCUMENT_REPLACED, () => this.rebuild());
  }

  /**
   * Builds the thumbnail list on first show; cancels the pending teardown otherwise.
   */
  onShow(): void {
    this.visible = true;
    if (this.teardownTimer) { clearTimeout(this.teardownTimer); this.teardownTimer = null; }
    if (!this.built) { void this.build(); } else { this.markCurrent(false); }
  }

  /**
   * Cancels in-flight renders and schedules canvas teardown after the tab has been hidden a while.
   */
  onHide(): void {
    this.visible = false;
    this.cancelAll();
    this.teardownTimer = setTimeout(() => this.reset(), TEARDOWN_AFTER_HIDDEN_MS);
  }

  private async build(): Promise<void> {
    this.built = true;
    const doc = this.ctx.pdfDocument;
    // Page 1's aspect ratio sizes every placeholder; the real ratio is applied when a page renders.
    const first = await doc.getPage(1);
    if (doc !== this.ctx.pdfDocument) { return; }
    const vp = first.getViewport({ scale: 1 });
    const ratio = vp.height / vp.width;
    this.observer = new IntersectionObserver((entries) => this.onIntersect(entries), {
      root: this.el,
      rootMargin: "300px 0px",
    });
    const frag = document.createDocumentFragment();
    for (let n = 1; n <= doc.numPages; n++) {
      const frame = renderElement("div", { class: "rd-thumb-frame", style: `width:${THUMB_CSS_WIDTH}px;height:${Math.round(THUMB_CSS_WIDTH * ratio)}px` });
      const thumb = renderElement("div", { class: "rd-thumb", role: "button", tabindex: 0, "data-page": n, title: `Page ${n}` }, frame, renderElement("span", { class: "rd-thumb-label" }, String(n)));
      thumb.addEventListener("click", () => this.goToPage(n));
      thumb.addEventListener("keydown", (e) => { if (e.key === "Enter") { this.goToPage(n); } });
      this.thumbs.push({ pageNumber: n, el: thumb, frame, state: "idle", task: null });
      this.observer.observe(thumb);
      frag.append(thumb);
    }
    this.list.append(frag);
    this.markCurrent(false);
  }

  private onIntersect(entries: IntersectionObserverEntry[]): void {
    for (const entry of entries) {
      const thumb = this.thumbs[Number((entry.target as HTMLElement).dataset["page"]) - 1];
      if (!thumb) { continue; }
      if (entry.isIntersecting && thumb.state === "idle") {
        thumb.state = "queued";
        this.queue.push(thumb);
      } else if (!entry.isIntersecting && thumb.state === "queued") {
        thumb.state = "idle";
        this.queue.splice(this.queue.indexOf(thumb), 1);
      } else if (!entry.isIntersecting && thumb.state === "rendering") {
        thumb.task?.cancel();
      }
    }
    this.pump();
  }

  private pump(): void {
    while (this.visible && this.running < MAX_CONCURRENT && this.queue.length > 0) {
      const thumb = this.queue.shift()!;
      this.running++;
      void this.renderThumb(thumb).finally(() => { this.running--; this.pump(); });
    }
  }

  private async renderThumb(thumb: Thumb): Promise<void> {
    thumb.state = "rendering";
    try {
      const page = await this.ctx.pdfDocument.getPage(thumb.pageNumber);
      const base = page.getViewport({ scale: 1 });
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale: (THUMB_CSS_WIDTH / base.width) * dpr });
      const canvas = renderElement("canvas", { class: "rd-thumb-canvas" });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      thumb.frame.style.height = `${Math.round(THUMB_CSS_WIDTH * (base.height / base.width))}px`;
      const canvasContext = canvas.getContext("2d", { alpha: false });
      if (!canvasContext) { throw new Error("2d context unavailable"); }
      const pageColors = this.theme.pageColors;
      thumb.task = page.render({
        canvas,
        canvasContext,
        viewport,
        ...(pageColors ? { pageColors } : {}),
      } as Parameters<typeof page.render>[0]);
      await thumb.task.promise;
      thumb.frame.replaceChildren(canvas);
      thumb.state = "done";
    } catch {
      // Cancelled (scrolled away, tab hidden, theme changed) or failed: eligible again next time it is on screen.
      thumb.state = "idle";
    } finally {
      thumb.task = null;
    }
  }

  private markCurrent(smooth: boolean): void {
    const current = this.ctx.pdfViewer.currentPageNumber;
    for (const t of this.thumbs) { t.el.classList.toggle("rd-active", t.pageNumber === current); }
    this.thumbs[current - 1]?.el.scrollIntoView({ block: "nearest", behavior: smooth ? "smooth" : "auto" });
  }

  private cancelAll(): void {
    for (const t of this.queue) { t.state = "idle"; }
    this.queue.length = 0;
    for (const t of this.thumbs) { t.task?.cancel(); }
  }

  /** Drops every canvas; they re-render lazily with the current page colours. */
  // The page count and sizes may differ in the new document, so the list starts over.
  private rebuild(): void {
    this.cancelAll();
    this.observer?.disconnect();
    this.observer = null;
    this.thumbs.length = 0;
    this.list.replaceChildren();
    this.built = false;
    if (this.visible) { void this.build(); }
  }

  private reset(): void {
    this.cancelAll();
    for (const t of this.thumbs) {
      if (t.state === "done") { t.frame.replaceChildren(); t.state = "idle"; }
    }
    if (this.visible && this.observer) {
      // Re-observing re-fires intersection callbacks for the thumbs currently on screen.
      for (const t of this.thumbs) { this.observer.unobserve(t.el); this.observer.observe(t.el); }
    }
  }
}
