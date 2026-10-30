/**
 * Shows a floating bubble over a text selection: five highlight colours, "send to…", "copy with citation" and, in a build preview, "comment".
 */
import { ANNOTATION_COLORS, type AnnotationColor } from "../../model/index.js";
import type { ReaderContext } from "./readerSession.js";
import { deriveClampedNumber, renderReaderIconButton } from "./elements.js";
import { deriveBoxInPage, derivePageFrame } from "./pageHighlights.js";
import { renderIcon } from "../../ui/index.js";
import { QMD_VOCABULARY } from "../../qmd/dom/index.js";
import { findElement, renderElement } from "../../ui/dom/index.js";

const HIDE_GRACE_MS = 150;

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
  private commentButton: HTMLButtonElement | null = null;

  /** `addToNote` runs just before the highlight of "Add to note" is posted. */
  constructor(private readonly ctx: ReaderContext, private readonly commentOn?: CommentOnSelection, private readonly addToNote?: () => void) {
    const mod = ctx.boot.isMac ? "Cmd" : "Ctrl";
    for (const color of ANNOTATION_COLORS) {
      const btn = renderElement("button", { class: `rd-color-btn rd-color-${color}`, type: "button", title: `Highlight ${color}`, "aria-label": `Highlight ${color}` });
      btn.addEventListener("click", () => { this.setColor(color); this.highlight(color); });
      this.el.append(btn);
    }
    if (addToNote) {
      const label = `Add to ${QMD_VOCABULARY.item}`;
      const add = renderReaderIconButton(renderIcon("note"), label, "rd-btn-sm");
      add.setAttribute("aria-label", label);
      add.addEventListener("click", () => this.highlight(ANNOTATION_COLORS[0]!, true));
      this.el.append(renderElement("div", { class: "rd-pill-sep" }), add);
    }
    const send = renderReaderIconButton(renderIcon("send"), "Send to…", "rd-btn-sm");
    send.setAttribute("aria-label", "Send to…");
    send.addEventListener("click", () => this.sendToNote());
    this.el.append(renderElement("div", { class: "rd-pill-sep" }), send);
    const cite = renderReaderIconButton(renderIcon("quote"), `Copy with citation (${mod}+Shift+C)`, "rd-btn-sm");
    cite.addEventListener("click", () => this.copyWithCitation());
    this.el.append(renderElement("div", { class: "rd-pill-sep" }), cite);
    if (commentOn) {
      const comment = renderReaderIconButton(renderIcon("message"), "Comment on the source", "rd-btn-sm");
      // Hidden until the host's roots say the shown PDF maps to its source, which a comment needs.
      comment.hidden = true;
      comment.addEventListener("click", () => this.comment());
      this.el.append(comment);
      this.commentButton = comment;
    }

    // Keep the selection alive while the bubble is being clicked.
    this.el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      if (this.hideTimer) { clearTimeout(this.hideTimer); }
    });
    document.addEventListener("mouseup", (e) => {
      if (this.el.contains(e.target as Node)) { return; }
      // The selection is final only after the browser has processed the mouseup.
      setTimeout(() => this.showForSelection(), 0);
    });
    document.addEventListener("mousedown", (e) => {
      if (this.el.contains(e.target as Node)) { return; }
      this.hideTimer = setTimeout(() => this.hide(), HIDE_GRACE_MS);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { this.setTool(null); }
    });
    ctx.container.addEventListener("pointerup", (event) => { setTimeout(() => this.placeNote(event), 0); });
    ctx.container.addEventListener("scroll", () => this.hide(), { passive: true });
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

  /** Sends the current selection to the host to be appended to a chosen note; it creates no highlight. */
  private sendToNote(): void {
    const info = this.currentSelection();
    if (!info) { return; }
    this.ctx.host.post({ command: "sendToNote", text: info.text, pageNumber: info.pageNumber });
    window.getSelection()?.removeAllRanges();
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

  /** Shows Comment only while the shown PDF maps to source positions. */
  setCommentable(on: boolean): void {
    if (this.commentButton) { this.commentButton.hidden = !on; }
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
    if (this.tool !== "note" || event.button !== 0 || this.currentSelection() || !(event.target instanceof Element)) { return; }
    if (event.target.closest(".rd-note-pin, .rd-note-box")) { return; }
    const page = event.target.closest<HTMLElement>("#viewer .page");
    const frame = page && derivePageFrame(page);
    if (!page || !frame) { return; }
    this.onPlaceNote?.(Number(page.dataset["pageNumber"]), Math.max(0, Math.min(1, (event.clientX - frame.left) / frame.width)), Math.max(0, Math.min(1, (event.clientY - frame.top) / frame.height)));
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
