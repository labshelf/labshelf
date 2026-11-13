// Builds the reader sidebar, its annotations tab and the page numbers of outline entries.
import type { PDFDocumentProxy } from "pdfjs-dist";
import { MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, type SidebarState, type SidebarTab, type OutlineRow } from "../index.js";
import { deriveClampedNumber, renderReaderIconButton } from "./elements.js";
import { renderIcon, type IconName } from "../../ui/index.js";
import { findElement, renderElement } from "../../ui/dom/index.js";
import type { Annotation } from "../../model/index.js";
import { QMD_VOCABULARY } from "../../qmd/dom/index.js";
import { compareAnnotations } from "../sidecar/index.js";
import type { HostBridge } from "./readerSession.js";
import { openQuoteMenu } from "./selectionBubble.js";

/**
 * Renders the reader's single left sidebar: a tab strip (Thumbnails / Outline / Annotations / Notes), a drag-resizable width with no
 * fixed maximum, and open/tab/width state reported for persistence. Dragging until the paper is narrower than PAPER_HIDE_AT hides the
 * paper so the sidebar fills the reader; dragging back, a double-click on the resizer or the strip's paper button shows it again.
 */

export interface SidebarPanel {
  readonly el: HTMLElement;
  onShow(): void;
  onHide(): void;
}

const DEFAULT_WIDTH = 220;
/** Below this width, in px, of the paper left beside the sidebar, the paper is hidden. */
const PAPER_HIDE_AT = 160;
const TAB_META: Record<SidebarTab, { label: string; icon: IconName }> = {
  thumbnails: { label: "Thumbnails", icon: "grid" },
  outline: { label: "Outline", icon: "list" },
  annotations: { label: "Annotations", icon: "edit" },
  notes: { label: `${QMD_VOCABULARY.item.charAt(0).toUpperCase()}${QMD_VOCABULARY.item.slice(1)}s`, icon: "note" },
};

export class Sidebar {
  private readonly el = findElement("sidebar");
  private readonly resizer = findElement("sidebar-resizer");
  private readonly body: HTMLElement;
  private readonly tabButtons = new Map<SidebarTab, HTMLButtonElement>();
  private open = false;
  private tab: SidebarTab = "outline";
  private width = DEFAULT_WIDTH;
  private paperHidden = false;
  private readonly paperButton: HTMLButtonElement;
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
    this.paperButton = renderElement("button", { class: "rd-tab rd-tab-paper", type: "button", html: renderIcon("panel-right") });
    this.paperButton.addEventListener("click", () => this.setPaperHidden(!this.paperHidden));
    strip.append(this.paperButton);
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
  get state(): SidebarState { return { open: this.open, tab: this.tab, width: this.width, ...(this.paperHidden ? { paperHidden: true } : {}) }; }
  get isOpen(): boolean { return this.open; }

  /**
   * Applies persisted state without echoing it back as a change.
   */
  restore(state: SidebarState): void {
    this.tab = state.tab;
    this.width = deriveClampedNumber(state.width ?? DEFAULT_WIDTH, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH);
    this.paperHidden = state.paperHidden === true;
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

  private setPaperHidden(hidden: boolean): void {
    if (hidden === this.paperHidden) { return; }
    this.paperHidden = hidden;
    this.render();
    this.emit();
  }

  private render(): void {
    this.el.hidden = !this.open;
    this.resizer.hidden = !this.open;
    this.el.style.width = `${this.width}px`;
    // A closed sidebar always shows the paper; the hidden state comes back when it reopens.
    document.documentElement.classList.toggle("rd-paper-hidden", this.open && this.paperHidden);
    const label = this.paperHidden ? "Show paper" : "Hide paper";
    this.paperButton.title = `${label} (double-click the divider)`;
    this.paperButton.setAttribute("aria-label", label);
    this.paperButton.setAttribute("aria-pressed", this.paperHidden ? "true" : "false");
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
      // From the hidden state the drag starts at the sidebar's full width, so dragging left brings the paper back.
      const startWidth = this.paperHidden ? this.el.getBoundingClientRect().width : this.width;
      const total = this.el.parentElement?.getBoundingClientRect().width ?? Infinity;
      document.documentElement.classList.add("rd-resizing");
      const move = (e: PointerEvent): void => {
        const wanted = startWidth + e.clientX - startX;
        const hide = total - wanted < PAPER_HIDE_AT;
        if (!hide) { this.width = deriveClampedNumber(wanted, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH); }
        if (hide !== this.paperHidden) { this.paperHidden = hide; }
        this.render();
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
    this.resizer.addEventListener("dblclick", () => this.setPaperHidden(!this.paperHidden));
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

  /** `citeInProject` is absent in a build preview, whose highlights are not of a library paper. */
  constructor(private readonly host: HostBridge, private readonly goToPage: (page: number) => void, private readonly citeInProject?: (page: number, quote: string) => void) {
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

  private citeButton(page: number, quote: string): HTMLButtonElement {
    const button = renderReaderIconButton(renderIcon("quote"), "Cite…", "rd-btn-sm rd-ann-delete");
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const cite = this.citeInProject;
      if (!cite) { return; }
      openQuoteMenu(button, {
        label: "Copy with citation", icon: "copy",
        run: () => this.host.post({ command: "copyWithCitation", text: quote, pageNumber: page }),
      }, () => cite(page, quote), "below", { page, quote });
    });
    return button;
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
      const cite = this.citeInProject && ann.type === "highlight" && content.trim() ? this.citeButton(ann.pageNumber, content) : null;
      const item = renderElement(
        "div",
        { class: "rd-ann-item", role: "button", tabindex: 0, title: `Go to page ${ann.pageNumber}` },
        renderElement("span", { class: `rd-ann-dot rd-color-${ann.color ?? "note"}` }),
        renderElement("span", { class: "rd-ann-text" }, preview),
        cite,
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
