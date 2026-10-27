// Builds the reader sidebar, its annotations tab and the page numbers of outline entries.
import type { PDFDocumentProxy } from "pdfjs-dist";
import { MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, type SidebarState, type SidebarTab, type OutlineRow } from "../../index.js";
import { deriveClampedNumber, renderReaderIconButton } from "../highlights/elements.js";
import { renderIcon, type IconName } from "../../../ui/index.js";
import { findElement, renderElement } from "../../../ui/dom/index.js";
import type { Annotation } from "../../../model/index.js";
import { compareAnnotations } from "../../sidecar/index.js";
import type { HostBridge } from "../session/index.js";

/**
 * Renders the reader's single left sidebar: a tab strip (Thumbnails / Outline / Annotations), a drag-resizable width, and open/tab/width state reported for persistence.
 */

export interface SidebarPanel {
  readonly el: HTMLElement;
  onShow(): void;
  onHide(): void;
}

const DEFAULT_WIDTH = 220;
const TAB_META: Record<SidebarTab, { label: string; icon: IconName }> = {
  thumbnails: { label: "Thumbnails", icon: "grid" },
  outline: { label: "Outline", icon: "list" },
  annotations: { label: "Annotations", icon: "edit" },
};

export class Sidebar {
  private readonly el = findElement("sidebar");
  private readonly resizer = findElement("sidebar-resizer");
  private readonly body: HTMLElement;
  private readonly tabButtons = new Map<SidebarTab, HTMLButtonElement>();
  private open = false;
  private tab: SidebarTab = "outline";
  private width = DEFAULT_WIDTH;
  private readonly listeners: Array<(state: SidebarState) => void> = [];

  constructor(private readonly panels: Record<SidebarTab, SidebarPanel>) {
    const strip = renderElement("div", { class: "rd-tabs", role: "tablist", "aria-label": "Sidebar" });
    for (const name of Object.keys(TAB_META) as SidebarTab[]) {
      const meta = TAB_META[name];
      const btn = renderElement("button", {
        class: "rd-tab", type: "button", role: "tab", title: meta.label, "aria-label": meta.label, html: renderIcon(meta.icon),
      });
      btn.addEventListener("click", () => this.select(name));
      this.tabButtons.set(name, btn);
      strip.append(btn);
    }
    this.body = renderElement("div", { class: "rd-sidebar-body" });
    for (const name of Object.keys(panels) as SidebarTab[]) {
      panels[name].el.hidden = true;
      this.body.append(panels[name].el);
    }
    this.el.append(strip, this.body);
    this.initResize();
    this.render();
  }

  /**
   * Registers a callback invoked whenever the open/tab/width state changes.
   */
  onChange(fn: (state: SidebarState) => void): void { this.listeners.push(fn); }
  get state(): SidebarState { return { open: this.open, tab: this.tab, width: this.width }; }
  get isOpen(): boolean { return this.open; }

  /**
   * Applies persisted state without echoing it back as a change.
   */
  restore(state: SidebarState): void {
    this.tab = state.tab;
    this.width = deriveClampedNumber(state.width ?? DEFAULT_WIDTH, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH);
    this.setOpen(state.open, false);
  }

  /**
   * Opens the sidebar if closed, closes it if open.
   */
  toggle(): void { this.setOpen(!this.open, true); }

  /**
   * Switches to the given tab, opening the sidebar first if needed.
   */
  select(tab: SidebarTab): void {
    if (this.open && this.tab === tab) { return; }
    const previous = this.tab;
    this.tab = tab;
    if (this.open && previous !== tab) { this.panels[previous].onHide(); }
    if (!this.open) { this.setOpen(true, true); return; }
    this.render();
    this.panels[tab].onShow();
    this.emit();
  }

  private setOpen(open: boolean, notify: boolean): void {
    const changed = open !== this.open;
    this.open = open;
    this.render();
    if (changed) {
      if (open) { this.panels[this.tab].onShow(); } else { this.panels[this.tab].onHide(); }
    }
    if (notify) { this.emit(); }
  }

  private render(): void {
    this.el.hidden = !this.open;
    this.resizer.hidden = !this.open;
    this.el.style.width = `${this.width}px`;
    for (const [name, btn] of this.tabButtons) {
      btn.setAttribute("aria-selected", name === this.tab ? "true" : "false");
    }
    for (const name of Object.keys(this.panels) as SidebarTab[]) {
      this.panels[name].el.hidden = name !== this.tab;
    }
  }

  private emit(): void {
    for (const fn of this.listeners) { fn(this.state); }
  }

  private initResize(): void {
    this.resizer.addEventListener("pointerdown", (down) => {
      down.preventDefault();
      this.resizer.setPointerCapture(down.pointerId);
      const startX = down.clientX;
      const startWidth = this.width;
      document.documentElement.classList.add("rd-resizing");
      const move = (e: PointerEvent): void => {
        this.width = deriveClampedNumber(startWidth + e.clientX - startX, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH);
        this.el.style.width = `${this.width}px`;
      };
      const up = (): void => {
        this.resizer.removeEventListener("pointermove", move);
        this.resizer.removeEventListener("pointerup", up);
        this.resizer.removeEventListener("pointercancel", up);
        document.documentElement.classList.remove("rd-resizing");
        this.emit();
      };
      this.resizer.addEventListener("pointermove", move);
      this.resizer.addEventListener("pointerup", up);
      this.resizer.addEventListener("pointercancel", up);
    });
  }
}

/**
 * Renders the Annotations tab: the paper's highlights and notes grouped by page, with jump, delete and Markdown export.
 */

const PREVIEW_CHARS = 140;

export class AnnotationsTab implements SidebarPanel {
  readonly el = renderElement("div", { class: "rd-panel rd-annotations", role: "tabpanel" });
  private readonly list = renderElement("div", { class: "rd-ann-list" });
  private annotations: Annotation[] = [];

  constructor(private readonly host: HostBridge, private readonly goToPage: (page: number) => void) {
    const copyBtn = renderReaderIconButton(renderIcon("clipboard"), "Copy annotations as Markdown", "rd-btn-sm");
    const fileBtn = renderReaderIconButton(renderIcon("download"), "Export annotations to a Markdown file", "rd-btn-sm");
    copyBtn.addEventListener("click", () => host.post({ command: "exportAnnotations", target: "clipboard" }));
    fileBtn.addEventListener("click", () => host.post({ command: "exportAnnotations", target: "file" }));
    this.el.append(
      renderElement("div", { class: "rd-panel-header" }, renderElement("span", {}, "Annotations"), renderElement("div", { class: "rd-panel-actions" }, copyBtn, fileBtn)),
      this.list,
    );
    this.render();
  }

  onShow(): void { /* always current */ }
  onHide(): void { /* nothing to release */ }

  /**
   * Replaces the displayed annotations and re-renders the list.
   */
  setAnnotations(annotations: Annotation[]): void {
    this.annotations = annotations;
    this.render();
  }

  private render(): void {
    if (this.annotations.length === 0) {
      this.list.replaceChildren(renderElement("div", { class: "rd-empty" }, "No annotations yet. Select text to highlight it."));
      return;
    }
    const sorted = [...this.annotations].sort(compareAnnotations);
    const frag = document.createDocumentFragment();
    let page = -1;
    for (const ann of sorted) {
      if (ann.pageNumber !== page) {
        page = ann.pageNumber;
        frag.append(renderElement("div", { class: "rd-ann-group" }, `Page ${page}`));
      }
      const content = ann.content ?? "";
      const preview = content.length > PREVIEW_CHARS ? `${content.slice(0, PREVIEW_CHARS)}…` : content;
      const del = renderReaderIconButton(renderIcon("trash"), "Delete annotation", "rd-btn-sm rd-ann-delete");
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        this.host.post({ command: "deleteAnnotation", id: ann.id });
      });
      const item = renderElement(
        "div",
        { class: "rd-ann-item", role: "button", tabindex: 0, title: `Go to page ${ann.pageNumber}` },
        renderElement("span", { class: `rd-ann-dot rd-color-${ann.color ?? "note"}` }),
        renderElement("span", { class: "rd-ann-text" }, preview),
        del,
      );
      const jump = (): void => this.goToPage(ann.pageNumber);
      item.addEventListener("click", jump);
      item.addEventListener("keydown", (e) => { if (e.key === "Enter") { jump(); } });
      frag.append(item);
    }
    this.list.replaceChildren(frag);
  }
}

// Resolves each outline entry's destination to a 1-based page number.

/**
 * @returns one page per row in order; an entry whose destination cannot be resolved stays null and never becomes active.
 */
export async function resolveOutlinePages(
  doc: Pick<PDFDocumentProxy, "getDestination" | "getPageIndex">,
  rows: OutlineRow[],
  isCurrent: () => boolean = () => true,
): Promise<Array<number | null>> {
  const pages: Array<number | null> = rows.map(() => null);
  for (const row of rows) {
    if (!isCurrent()) { return pages; }
    try {
      const explicit = typeof row.dest === "string" ? await doc.getDestination(row.dest) : row.dest;
      const ref = Array.isArray(explicit) ? (explicit[0] as unknown) : null;
      if (ref && typeof ref === "object") {
        pages[row.id] = (await doc.getPageIndex(ref as Parameters<typeof doc.getPageIndex>[0])) + 1;
      } else if (typeof ref === "number" && Number.isInteger(ref)) {
        pages[row.id] = ref + 1;
      }
    } catch {
      // An unresolvable entry simply never becomes active.
    }
  }
  return pages;
}
