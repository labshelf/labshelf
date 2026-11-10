// Opens anchored PDF notes in a floating rich editor and draws their page pins independently of highlights.
import type { Annotation } from "../../model/index.js";
import type { CellRunInfo, CellRunState } from "../../qmd/compute/index.js";
import { compareNotesByPlace, listBodiesBefore, ReaderCellRuns } from "./cellRuns.js";
import { mountQmdEditor, type QmdEditorHandle } from "../../qmd/dom/index.js";
import { formatAnchor, parseAnchor } from "../../qmd/item/index.js";
import { renderElement, renderIcon } from "../../ui/dom/index.js";
import type { ReaderNote } from "../protocol/index.js";
import { deriveClampedNumber, renderReaderIconButton } from "./elements.js";
import type { ReaderContext } from "./readerSession.js";
import { readerNoteFiles } from "./notesTab.js";
import { NoteQuote } from "./noteQuote.js";
import { NoteDrafts } from "./noteDrafts.js";

/** The popup's size limits; past the largest the note is opened in the sidebar instead. */
const MIN_SIZE = { width: 320, height: 220 };
const MAX_WIDTH = 640;
const MAX_HEIGHT_SHARE = 0.8;
const RESIZE_STEP = 16;

interface NotePosition { page: number; x: number; y: number }
interface OpenNote { id: string; editor: QmdEditorHandle; latest: string }

export class FloatingNotes {
  private readonly drafts: NoteDrafts;
  private notes: readonly ReaderNote[] = [];
  private annotations = new Map<string, Annotation>();
  private readonly pins = new Map<string, HTMLElement>();
  private pending: { anchor: string; known: Set<string> } | null = null;
  private awaitingHighlight = false;
  private current: OpenNote | null = null;
  private readonly el = renderElement("section", { class: "rd-floating-note", role: "dialog", "aria-label": "Paper note", hidden: true });
  private readonly source = renderElement("button", { class: "rd-floating-note-source", type: "button" });
  private readonly body = renderElement("div", { class: "rd-floating-note-body" });
  private readonly status = renderElement("span", { class: "rd-floating-note-status", role: "status", "aria-live": "polite" }, "Saved");
  private readonly quote = new NoteQuote();
  /** The size the user dragged the popup to; kept while the reader is open, so the next note opens at it. */
  private size: { width: number; height: number } | null = null;
  /** Runs this surface's note cells; readerUi routes the host's cellPreview to it. */
  readonly runs: ReaderCellRuns;

  constructor(private readonly ctx: ReaderContext, private readonly openFull: (id: string, body: string) => void) {
    this.runs = new ReaderCellRuns(ctx.host);
    this.drafts = new NoteDrafts(ctx.host);
    const close = renderReaderIconButton(renderIcon("x"), "Close note", "rd-btn-sm");
    close.addEventListener("click", () => { const id = this.current?.id; this.close(); if (id) { this.pins.get(id)?.focus(); } });
    const full = renderReaderIconButton(renderIcon("external"), "Open full note", "rd-btn-sm rd-floating-note-full");
    full.addEventListener("click", () => this.revealFull());
    this.source.addEventListener("click", () => {
      const note = this.notes.find((item) => item.id === this.current?.id);
      const at = note && this.position(note);
      if (at) { ctx.pdfViewer.currentPageNumber = at.page; }
    });
    // One quiet line over the text: what it is and where it points, then the two actions; the save status sits under the text.
    // Only the simple view of the note is offered here: no note bar, so no Advanced switch; the full note in the sidebar has them.
    this.el.append(renderElement("header", { class: "rd-floating-note-header" }, renderElement("span", { class: "rd-floating-note-title" }, "Note"), this.source, renderElement("span", { class: "rd-floating-note-actions" }, full, close)), this.body, this.renderResizeHandle());
    document.body.append(this.el);
    ctx.eventBus.on("textlayerrendered", () => this.paint());
    ctx.container.addEventListener("scroll", () => this.place(), { passive: true });
    window.addEventListener("resize", () => this.place());
    this.el.addEventListener("keydown", (event) => { if (event.key === "Escape") { event.stopPropagation(); close.click(); } });
    document.addEventListener("pointerdown", (event) => {
      if (this.current && event.target instanceof Element && !this.el.contains(event.target) && !event.target.closest(".rd-note-pin, .ls-menu, .ls-quick, .ls-dialog, .ls-scrim, .qmd-plot-preview")) { this.close(); }
    });
  }

  /** The next annotation made by Add to note gets an item and a floating editor. */
  expectHighlight(): void { this.awaitingHighlight = true; }

  addPoint(page: number, x: number, y: number): void {
    this.create(formatAnchor({ kind: "point", page, x, y }));
  }

  setAnnotations(annotations: readonly Annotation[]): void {
    const added = this.awaitingHighlight ? annotations.find((item) => !this.annotations.has(item.id)) : undefined;
    this.annotations = new Map(annotations.map((item) => [item.id, item]));
    if (added) { this.awaitingHighlight = false; this.create(`hl:${added.id}`); }
    const open = this.notes.find((item) => item.id === this.current?.id);
    if (open) { this.renderQuote(open); }
    this.paint();
  }

  /** Applies the stored notes; the open editor takes the stored body (a cell output, say) unless it holds edits the host has not acknowledged. */
  show(notes: readonly ReaderNote[]): void {
    this.current?.editor.flush();
    this.notes = notes;
    this.drafts.settle(notes);
    const current = this.current;
    const stored = notes.find((item) => item.id === current?.id);
    if (current && !stored) { this.close(false); }
    if (current && stored) {
      if (this.drafts.takesStored(current.id, current.latest, stored.body)) {
        current.latest = stored.body;
        current.editor.setBody(stored.body);
      }
      this.status.textContent = this.drafts.has(current.id) ? "Saving…" : "Saved";
    }
    this.paint();
    const pending = this.pending;
    const added = pending && notes.find((item) => item.anchor === pending.anchor && !pending.known.has(item.id));
    if (added) { this.pending = null; this.open(added); }
  }

  /** Whether the host can run cells; an open note is remounted so its cells gain or lose the Run button. */
  setCanRunCells(canRun: boolean): void {
    if (!this.runs.setCanRun(canRun)) { return; }
    const note = this.notes.find((item) => item.id === this.current?.id);
    if (note) { this.close(); this.open(note); }
  }

  /** Shows the host's state of a run under the open note; a request this editor did not send is ignored. */
  showCellState(requestId: string, state: CellRunState, info?: CellRunInfo): void { this.runs.show(requestId, state, info); }


  close(flush = true): void {
    if (flush) { this.current?.editor.flush(); }
    this.current?.editor.destroy();
    this.current = null;
    this.quote.disconnect();
    this.el.hidden = true;
    for (const pin of this.pins.values()) { pin.setAttribute("aria-expanded", "false"); }
  }

  private create(anchor: string): void {
    this.pending = { anchor, known: new Set(this.notes.map((item) => item.id)) };
    this.ctx.host.post({ command: "addNote", anchor, body: "" });
  }

  private position(note: ReaderNote): NotePosition | null {
    const anchor = parseAnchor(note.anchor);
    if (anchor.kind === "point") { return anchor; }
    if (anchor.kind === "box") { return { page: anchor.page, x: Math.min(1, anchor.x + anchor.w), y: anchor.y }; }
    const mark = anchor.kind === "highlight" ? this.annotations.get(anchor.annotationId) : undefined;
    return mark?.position ? { page: mark.pageNumber, x: Math.min(1, mark.position.x + mark.position.width + 0.012), y: mark.position.y + mark.position.height / 2 } : null;
  }

  private paint(): void {
    for (const pin of this.pins.values()) { pin.remove(); }
    this.pins.clear();
    const counts = new Map<number, number>();
    const ordered = [...this.notes].sort(compareNotesByPlace(this.annotations));
    for (const note of ordered) {
      if (parseAnchor(note.anchor).kind === "box") { continue; }
      const at = this.position(note);
      if (!at) { continue; }
      const index = (counts.get(at.page) ?? 0) + 1;
      counts.set(at.page, index);
      const number = String(index).padStart(2, "0");
      const page = document.querySelector<HTMLElement>(`#viewer .page[data-page-number="${at.page}"]`);
      if (!page) { continue; }
      const pin = renderElement("button", {
        class: "rd-btn rd-note-pin", type: "button", title: `Note ${number} · Page ${at.page}`,
        "aria-label": `Open note ${number} on page ${at.page}`, "aria-expanded": String(this.current?.id === note.id),
      }, renderElement("span", { class: "rd-note-pin-label", "aria-hidden": "true" }, number));
      pin.dataset["noteId"] = note.id;
      pin.style.left = `${at.x * 100}%`;
      pin.style.top = `${at.y * 100}%`;
      pin.addEventListener("click", () => this.open(note));
      page.append(pin);
      this.pins.set(note.id, pin);
    }
    this.place();
  }

  /** The bodies (drafts where there are any) of the notes listed before note `id`. */
  private bodiesBefore(id: string): string[] {
    return listBodiesBefore(this.notes, this.drafts.map, id, compareNotesByPlace(this.annotations));
  }

  private open(note: ReaderNote): void {
    if (this.current?.id === note.id) { this.current.editor.focus(); return; }
    this.close();
    // The same editor look as the sidebar's note: its text size, the passage quote above and the line gutter whose '+' replaces the round one.
    const root = renderElement("div", { class: "rd-note-editor" });
    this.quote.reset();
    this.renderQuote(note);
    this.body.replaceChildren(this.quote.el, root);
    const body = this.drafts.get(note.id) ?? note.body;
    const editor = mountQmdEditor(root, {
      body,
      onChange: (body) => {
        if (!this.current || this.current.id !== note.id) { return; }
        this.current.latest = body;
        this.drafts.save(note.id, body);
        this.status.textContent = "Saving…";
      },
      status: this.status,
      gutter: {},
      files: readerNoteFiles(this.ctx.host),
      ...this.runs.option(note.id, root, { earlier: () => this.bodiesBefore(note.id), own: () => this.current?.latest ?? body }),
    });
    this.current = { id: note.id, editor, latest: body };
    for (const [id, pin] of this.pins) { pin.setAttribute("aria-expanded", String(id === note.id)); }
    const at = this.position(note);
    this.source.textContent = at ? `Page ${at.page}` : "";
    this.source.hidden = !at;
    this.status.textContent = this.drafts.has(note.id) ? "Saving…" : "Saved";
    this.el.hidden = false;
    this.applySize();
    this.place();
    editor.focus();
  }

  private place(): void {
    if (!this.current || this.el.hidden) { return; }
    const pin = this.pins.get(this.current.id)?.getBoundingClientRect();
    const box = this.el.getBoundingClientRect();
    const right = pin ? pin.right + 12 : window.innerWidth - box.width - 16;
    const left = pin && right + box.width > window.innerWidth - 8 ? pin.left - box.width - 12 : right;
    this.el.style.left = `${deriveClampedNumber(left, 8, Math.max(8, window.innerWidth - box.width - 8))}px`;
    this.el.style.top = `${deriveClampedNumber(pin?.top ?? 64, 8, Math.max(8, window.innerHeight - box.height - 8))}px`;
  }

  /** The highlighted passage of a note on a highlight; other notes have none. */
  private renderQuote(note: ReaderNote): void {
    const anchor = parseAnchor(note.anchor);
    const mark = anchor.kind === "highlight" ? this.annotations.get(anchor.annotationId) : undefined;
    this.quote.render(mark?.content || (anchor.kind === "quote" ? anchor.quote : undefined), mark ? mark.color ?? "note" : undefined);
  }

  /** The largest size the popup may take at its current place: the limits, cut to the window. */
  private maxSize(): { width: number; height: number } {
    const box = this.el.getBoundingClientRect();
    return {
      width: Math.max(MIN_SIZE.width, Math.min(MAX_WIDTH, window.innerWidth - box.left - 8)),
      height: Math.max(MIN_SIZE.height, Math.min(window.innerHeight * MAX_HEIGHT_SHARE, window.innerHeight - box.top - 8)),
    };
  }

  private resizeTo(width: number, height: number): void {
    const max = this.maxSize();
    this.size = { width: deriveClampedNumber(width, MIN_SIZE.width, max.width), height: deriveClampedNumber(height, MIN_SIZE.height, max.height) };
    this.applySize();
  }

  private applySize(): void {
    this.el.style.width = this.size ? `${this.size.width}px` : "";
    this.el.style.height = this.size ? `${this.size.height}px` : "";
  }

  /** The corner grip: dragging it, or the arrow keys while it has focus, sizes the popup within the limits. */
  private renderResizeHandle(): HTMLElement {
    const handle = renderElement("div", { class: "rd-floating-note-resize", role: "separator", tabindex: "0", "aria-label": "Resize note", title: "Drag to resize" });
    handle.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      const box = this.el.getBoundingClientRect();
      const start = { x: event.clientX, y: event.clientY, width: box.width, height: box.height };
      handle.setPointerCapture?.(event.pointerId);
      const move = (next: PointerEvent): void => this.resizeTo(start.width + next.clientX - start.x, start.height + next.clientY - start.y);
      const end = (): void => { handle.removeEventListener("pointermove", move); handle.removeEventListener("pointerup", end); handle.removeEventListener("pointercancel", end); };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", end);
      handle.addEventListener("pointercancel", end);
    });
    handle.addEventListener("keydown", (event) => {
      const step: Record<string, [number, number]> = { ArrowLeft: [-RESIZE_STEP, 0], ArrowRight: [RESIZE_STEP, 0], ArrowUp: [0, -RESIZE_STEP], ArrowDown: [0, RESIZE_STEP] };
      const delta = step[event.key];
      if (!delta) { return; }
      event.preventDefault();
      const box = this.el.getBoundingClientRect();
      this.resizeTo(box.width + delta[0], box.height + delta[1]);
    });
    return handle;
  }

  private revealFull(): void {
    const current = this.current;
    if (!current) { return; }
    current.editor.flush();
    const { id, latest } = current;
    this.close();
    this.openFull(id, latest);
  }
}
