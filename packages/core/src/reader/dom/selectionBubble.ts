/**
 * Shows a floating bubble over a text selection: five highlight colours, "add to note" when the host keeps notes, one
 * quote button that opens the cite popup (or, without one, copies with citation) and, in a build preview whose shown PDF has
 * source links, "view in source" (the inverse of the editor's View in PDF) and "comment". A right click in the pages opens the app's menu instead of the
 * system's: the same actions with Copy and a Highlight submenu on a selection, Add note here elsewhere on a page.
 */
import { ANNOTATION_COLORS, type AnnotationColor } from "../../model/index.js";
import type { ReaderContext } from "./readerSession.js";
import { closePopover, deriveClampedNumber, openMenuPopover } from "./elements.js";
import { deriveSelectionStartPoint } from "./navigation.js";
import { deriveBoxInPage, derivePageFrame } from "./pageHighlights.js";
import { renderIcon, type IconName } from "../../ui/index.js";
import { QMD_VOCABULARY } from "../../qmd/dom/index.js";
import { editMenuEntries, findElement, renderElement, renderPillBar, runClipboardCommand, showMenu, type MenuEntry, type MenuTreeEntry, type PillButton } from "../../ui/dom/index.js";
import { isReaderKeyEvent } from "./scope.js";

const HIDE_GRACE_MS = 150;

/** One item of the quote menu. */
export interface QuoteMenuChoice { label: string; icon: IconName; run(): void }

/** What a quote menu cites: the page and passage, both absent for the whole paper. */
export interface QuoteMenuCitation { page?: number | undefined; quote?: string | undefined }

let quoteMenuExtras: ((citation: QuoteMenuCitation) => QuoteMenuChoice[]) | undefined;

/** Adds choices after Cite in a project… in every quote menu of this page (Cite in an open manuscript window); undefined removes them. */
export function setQuoteMenuExtras(extras: ((citation: QuoteMenuCitation) => QuoteMenuChoice[]) | undefined): void {
  quoteMenuExtras = extras;
}

/**
 * Opens the small menu a quote (Cite…) button shows: copy the citation, or cite in a project, then the page's extra choices for `citation`.
 * Reuses the reader's anchored popover, so Escape or a click outside closes it and the first item takes focus; clicking the same button again closes it.
 */
export function openQuoteMenu(anchor: HTMLElement, copy: QuoteMenuChoice, cite: () => void, placement: "below" | "above", citation: QuoteMenuCitation = {}): void {
  const menu = renderElement("div", { class: "rd-menu", role: "menu", "aria-label": "Cite" });
  for (const choice of [copy, { label: "Cite in a project…", icon: "book-plus" as const, run: cite }, ...(quoteMenuExtras?.(citation) ?? [])]) {
    const item = renderElement("button", { class: "rd-menu-item", type: "button", role: "menuitem" },
      renderElement("span", { class: "rd-menu-icon", html: renderIcon(choice.icon), "aria-hidden": "true" }),
      renderElement("span", { class: "rd-menu-label" }, choice.label));
    item.addEventListener("click", () => { closePopover(); choice.run(); });
    menu.append(item);
  }
  openMenuPopover(anchor, menu, placement);
}

interface SelectionBubbleContent {
  text: string;
  pageNumber: number;
  page: HTMLElement;
}

/** Comments on the selection; `start` is its first line on screen and `bounds` its whole extent. */
type CommentOnSelection = (selection: SelectionBubbleContent & { start: DOMRect; bounds: DOMRect }) => void;

export class SelectionBubble {
  private readonly el = findElement("selection-toolbar");
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  onToolChange: ((tool: "highlight" | "underline" | "note" | null) => void) | null = null;
  onColorChange: ((color: AnnotationColor) => void) | null = null;
  onPlaceNote: ((page: number, x: number, y: number) => void) | null = null;
  private color: AnnotationColor = "yellow";
  private tool: "highlight" | "underline" | "note" | null = null;
  /** The preview buttons and their separator, shown only while the shown PDF maps to its source. */
  private sourceLinked: HTMLElement[] = [];
  /** Whether the shown PDF maps to its source now, for the right-click menu's View in source and Comment. */
  private linked = false;

  /** `addToNote` runs just before the highlight of "Add to note" is posted; `openCite` is absent in a build preview and for a paper without a cite key. */
  constructor(
    private readonly ctx: ReaderContext, private readonly commentOn?: CommentOnSelection, private readonly addToNote?: () => void,
    private readonly openCite?: (citation: { page: number; quote: string }) => void,
  ) {
    this.renderButtons(openCite);
    this.bindDocumentEvents();
    ctx.container.addEventListener("pointerup", (event) => { setTimeout(() => this.placeNote(event), 0); });
    ctx.container.addEventListener("contextmenu", (event) => this.openContextMenu(event));
    ctx.container.addEventListener("scroll", () => this.hide(), { passive: true });
  }

  private colorButtons(): HTMLElement[] {
    return ANNOTATION_COLORS.map((color) => {
      const btn = renderElement("button", { class: `rd-color-btn rd-color-${color}`, type: "button", title: `Highlight ${color}`, "aria-label": `Highlight ${color}` });
      btn.addEventListener("click", () => { this.setColor(color); this.highlight(color); });
      return btn;
    });
  }

  private citeButton(openCite?: (citation: { page: number; quote: string }) => void): PillButton {
    const mod = this.ctx.boot.isMac ? "Cmd" : "Ctrl";
    return {
      label: openCite ? "Cite…" : `Copy with citation (${mod}+Shift+C)`, icon: "quote",
      run: (button) => {
        if (!openCite) { this.copyWithCitation(); return; }
        // Captured now: the menu takes focus and the selection may be gone when an item is chosen.
        const info = this.currentSelection();
        if (!info) { return; }
        const { pageNumber, text } = info;
        openQuoteMenu(button, {
          label: "Copy with citation", icon: "copy",
          run: () => { this.ctx.host.post({ command: "copyWithCitation", text, pageNumber }); this.hide(); },
        }, () => { openCite({ page: pageNumber, quote: text }); this.hide(); }, "below", { page: pageNumber, quote: text });
      },
    };
  }

  private renderButtons(openCite?: (citation: { page: number; quote: string }) => void): void {
    const add: PillButton[] = this.addToNote ? [{ label: `Add to ${QMD_VOCABULARY.item}`, icon: "note", run: () => this.highlight(ANNOTATION_COLORS[0]!, true) }] : [];
    // In a preview, View in source and Comment are hidden until the host's roots say the shown PDF maps to its source; their separator hides with them.
    const source: PillButton[] = this.ctx.boot.preview ? [
      { label: "View in source", icon: "code", run: () => this.viewInSource() },
      ...(this.commentOn ? [{ label: "Comment on the source", icon: "message" as const, run: () => this.comment() }] : []),
    ] : [];
    renderPillBar([this.colorButtons(), add, [this.citeButton(openCite)], source], { label: "Selection", pill: this.el });
    if (source.length > 0) {
      const buttons = [...this.el.querySelectorAll<HTMLElement>(".ls-pill-btn")].slice(-source.length);
      this.sourceLinked = [buttons[0]!.previousElementSibling as HTMLElement, ...buttons];
      this.setSourceLinked(false);
    }
  }

  private bindDocumentEvents(): void {
    // Keep the selection alive while the bubble is being clicked.
    this.el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      if (this.hideTimer) { clearTimeout(this.hideTimer); }
    });
    // The quote menu and the right-click menu are outside the bubble; choosing from them is not a new selection.
    const inBubble = (target: EventTarget | null): boolean => this.el.contains(target as Node) || (target instanceof Element && target.closest(".rd-popover, .ls-menu, .ls-scrim") !== null);
    document.addEventListener("mouseup", (e) => {
      // A right click keeps the selection for its menu instead of showing the bubble under it.
      if (e.button !== 0 || inBubble(e.target)) { return; }
      // The selection is final only after the browser has processed the mouseup.
      setTimeout(() => this.showForSelection(), 0);
    });
    document.addEventListener("mousedown", (e) => {
      if (inBubble(e.target)) { return; }
      this.hideTimer = setTimeout(() => this.hide(), HIDE_GRACE_MS);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && isReaderKeyEvent(event)) { this.setTool(null); }
    });
  }

  /**
   * The highlight belongs to the page that contains the selected text, which is not necessarily the viewer's "current" page when two pages share the screen.
   * @returns the selected text and the page it belongs to, or null when nothing usable is selected.
   */
  currentSelection(): SelectionBubbleContent | null {
    const sel = window.getSelection();
    const text = sel?.toString().trim() ?? "";
    if (!sel || !text || sel.rangeCount === 0) { return null; }
    const start = sel.getRangeAt(0).startContainer;
    const startEl = start instanceof Element ? start : start.parentElement;
    const pageEl = startEl?.closest<HTMLElement>("#viewer .page");
    if (!pageEl) { return null; }
    const pageNumber = Number(pageEl.dataset["pageNumber"]) || this.ctx.pdfViewer.currentPageNumber;
    return { text, pageNumber, page: pageEl };
  }

  /**
   * Sends the current selection to the host to be copied with a citation.
   */
  copyWithCitation(): void {
    const info = this.currentSelection();
    if (!info) { return; }
    this.ctx.host.post({ command: "copyWithCitation", text: info.text, pageNumber: info.pageNumber });
    this.hide();
  }

  private comment(): void {
    const info = this.currentSelection();
    const range = window.getSelection()?.getRangeAt(0);
    if (!info || !range || !this.commentOn) { return; }
    const bounds = range.getBoundingClientRect();
    this.commentOn({ ...info, start: range.getClientRects()[0] ?? bounds, bounds });
    window.getSelection()?.removeAllRanges();
    this.hide();
  }

  /** Opens the source line behind the start of the selection; a page pdf.js has not laid out yet gives no point, so nothing is sent. */
  private viewInSource(): void {
    const info = this.currentSelection();
    const range = window.getSelection()?.getRangeAt(0);
    if (!info || !range) { return; }
    const point = deriveSelectionStartPoint(this.ctx.pdfViewer, { ...info, start: range.getClientRects()[0] ?? range.getBoundingClientRect() });
    if (!point) { return; }
    this.ctx.host.post({ command: "showSource", point });
    window.getSelection()?.removeAllRanges();
    this.hide();
  }

  /** Shows View in source and Comment only while the shown PDF maps to source positions. */
  setSourceLinked(on: boolean): void {
    this.linked = on;
    for (const el of this.sourceLinked) { el.hidden = !on; }
  }

  /** The app's menu on a right click in the pages: on a selection its copy, cite, mark and source rows, elsewhere on a page Add note here. */
  private openContextMenu(event: MouseEvent): void {
    const info = this.currentSelection();
    const range = info ? window.getSelection()?.getRangeAt(0).cloneRange() : undefined;
    const entries = info && range ? this.selectionEntries(info, range) : this.pageEntries(event);
    if (entries.length === 0) { return; }
    event.preventDefault();
    this.hide();
    showMenu({ x: event.clientX, y: event.clientY }, entries);
  }

  /** The rows of a selection; each puts the selection back first, since choosing from the menu may have cleared it. */
  private selectionEntries(info: SelectionBubbleContent, range: Range): MenuTreeEntry[] {
    const { text, pageNumber } = info;
    const restored = (run: () => void) => (): void => {
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      run();
    };
    const copy: MenuEntry[] = [
      ...editMenuEntries({ hasSelection: true, copy: restored(() => runClipboardCommand("copy")) }),
      { label: "Copy with citation", icon: "copy", onSelect: () => { this.ctx.host.post({ command: "copyWithCitation", text, pageNumber }); this.hide(); } },
      ...(this.openCite ? [{ label: "Cite in a project…", icon: "book-plus" as const, onSelect: () => { this.openCite!({ page: pageNumber, quote: text }); this.hide(); } }] : []),
    ];
    const colors = ANNOTATION_COLORS.map((color): MenuEntry => ({
      label: `${color[0]!.toUpperCase()}${color.slice(1)}`, lead: `<span class="rd-menu-swatch rd-color-${color}"></span>`,
      onSelect: restored(() => { this.setColor(color); this.highlight(color); }),
    }));
    const mark: MenuTreeEntry[] = [
      { label: "Highlight", lead: `<span class="rd-menu-swatch rd-color-${this.color}"></span>`, submenu: colors },
      { label: "Underline", onSelect: restored(() => this.highlight(this.color, false, true)) },
      ...(this.addToNote ? [{ label: `Add to ${QMD_VOCABULARY.item}`, icon: "note" as const, onSelect: restored(() => this.highlight(ANNOTATION_COLORS[0]!, true)) }] : []),
    ];
    const source: MenuEntry[] = this.ctx.boot.preview && this.linked ? [
      { label: "View in source", icon: "code", onSelect: restored(() => this.viewInSource()) },
      ...(this.commentOn ? [{ label: "Comment on the source", icon: "message" as const, onSelect: restored(() => this.comment()) }] : []),
    ] : [];
    const sections: MenuTreeEntry[][] = [copy, mark, source];
    return sections.filter((section) => section.length > 0).flatMap((section, index) => (index === 0 ? section : ["separator" as const, ...section]));
  }

  /** Off a selection: Add note here, on a page the viewer has laid out, when the host keeps notes. */
  private pageEntries(event: MouseEvent): MenuEntry[] {
    const place = this.onPlaceNote;
    const point = place && this.notePoint(event);
    return point ? [{ label: "Add note here", icon: "note", onSelect: () => place(point.page, point.x, point.y) }] : [];
  }

  /** The page under `event` and where on it, as fractions of its size; null off a page or on a page with no size yet. */
  private notePoint(event: MouseEvent): { page: number; x: number; y: number } | null {
    if (!(event.target instanceof Element) || event.target.closest(".rd-note-pin, .rd-note-box")) { return null; }
    const page = event.target.closest<HTMLElement>("#viewer .page");
    const frame = page && derivePageFrame(page);
    if (!page || !frame) { return null; }
    const clamp = (value: number): number => Math.max(0, Math.min(1, value));
    return { page: Number(page.dataset["pageNumber"]), x: clamp((event.clientX - frame.left) / frame.width), y: clamp((event.clientY - frame.top) / frame.height) };
  }

  /**
   * Hides the bubble.
   */
  hide(): void {
    this.el.classList.remove("rd-visible");
  }

  setTool(tool: "highlight" | "underline" | "note" | null): void {
    this.tool = this.tool === tool ? null : tool;
    this.ctx.container.classList.toggle("rd-note-mode", this.tool === "note");
    this.onToolChange?.(this.tool);
    if (this.tool && this.currentSelection()) { this.applyTool(); }
  }

  setColor(color: AnnotationColor): void { this.color = color; this.onColorChange?.(color); }

  private placeNote(event: PointerEvent): void {
    if (this.tool !== "note" || event.button !== 0 || this.currentSelection()) { return; }
    const point = this.notePoint(event);
    if (!point) { return; }
    this.onPlaceNote?.(point.page, point.x, point.y);
    this.setTool(null);
  }

  private applyTool(): void {
    const tool = this.tool;
    if (!tool) { return; }
    this.highlight(this.color, tool === "note", tool === "underline");
  }

  private highlight(color: AnnotationColor, asNote = false, underline = false): void {
    const info = this.currentSelection();
    const sel = window.getSelection();
    if (!info || !sel) { return; }
    if (asNote) { this.addToNote?.(); }
    // Measured before the selection is cleared; a page without a size yet gives a highlight that is only listed.
    const frame = derivePageFrame(info.page);
    const position = frame ? deriveBoxInPage(sel.getRangeAt(0).getBoundingClientRect(), frame) : null;
    this.ctx.host.post({
      command: "createAnnotation", type: "highlight", pageNumber: info.pageNumber, content: info.text, color,
      ...(underline ? { style: "underline" as const } : {}),
      ...(position ? { position: { ...position } } : {}),
    });
    sel.removeAllRanges();
    if (asNote) { this.setTool(null); }
    this.hide();
  }

  private showForSelection(): void {
    const info = this.currentSelection();
    const sel = window.getSelection();
    if (!info || !sel || sel.rangeCount === 0) { this.hide(); return; }
    if (this.tool) { this.applyTool(); return; }
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    this.el.classList.add("rd-visible");
    const own = this.el.getBoundingClientRect();
    const above = rect.top - own.height - 8;
    const top = above >= 8 ? above : rect.bottom + 8;
    this.el.style.top = `${deriveClampedNumber(top, 8, window.innerHeight - own.height - 8)}px`;
    this.el.style.left = `${deriveClampedNumber(rect.left + rect.width / 2 - own.width / 2, 8, window.innerWidth - own.width - 8)}px`;
  }
}
