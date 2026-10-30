// Opens anchored PDF notes in a floating rich editor and draws their page pins independently of highlights.
import type { Annotation } from "../../model/index.js";
import type { CellRunState } from "../../qmd/compute/index.js";
import { ReaderCellRuns } from "./cellRuns.js";
import { mountQmdEditor, type QmdEditorHandle } from "../../qmd/dom/index.js";
import { formatAnchor, parseAnchor, sameItemBody } from "../../qmd/item/index.js";
import { renderElement, renderIcon } from "../../ui/dom/index.js";
import type { ReaderNote } from "../protocol/index.js";
import { deriveClampedNumber, renderReaderIconButton } from "./elements.js";
import type { ReaderContext } from "./readerSession.js";

interface NotePosition { page: number; x: number; y: number }
interface OpenNote { id: string; editor: QmdEditorHandle; latest: string }

export class FloatingNotes {
  private readonly drafts = new Map<string, string>();
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
  private readonly runs: ReaderCellRuns;

  constructor(private readonly ctx: ReaderContext, private readonly openFull: (id: string, body: string) => void) {
    this.runs = new ReaderCellRuns(ctx.host);
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
    this.el.append(renderElement("header", { class: "rd-floating-note-header" }, renderElement("span", { class: "rd-floating-note-title" }, "Note"), this.source, renderElement("span", { class: "rd-floating-note-actions" }, full, close)), this.body);
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

  openNote(id: string): void { const note = this.notes.find((item) => item.id === id); if (note) { this.open(note); } }

  addPoint(page: number, x: number, y: number): void {
    this.create(formatAnchor({ kind: "point", page, x, y }));
  }

  setAnnotations(annotations: readonly Annotation[]): void {
    const added = this.awaitingHighlight ? annotations.find((item) => !this.annotations.has(item.id)) : undefined;
    this.annotations = new Map(annotations.map((item) => [item.id, item]));
    if (added) { this.awaitingHighlight = false; this.create(`hl:${added.id}`); }
    this.paint();
  }

  /** Applies the stored notes; the open editor takes the stored body (a cell output, say) unless it holds edits the host has not acknowledged. */
  show(notes: readonly ReaderNote[]): void {
    this.current?.editor.flush();
    this.notes = notes;
    for (const [id, body] of this.drafts) {
      const stored = notes.find((note) => note.id === id);
      if (!stored || sameItemBody(stored.body, body)) { this.drafts.delete(id); }
    }
    const current = this.current;
    const stored = notes.find((item) => item.id === current?.id);
    if (current && !stored) { this.close(false); }
    if (current && stored) {
      if (!this.drafts.has(current.id) && !sameItemBody(current.latest, stored.body)) {
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
  showCellState(requestId: string, state: CellRunState): void { this.runs.show(requestId, state); }

  close(flush = true): void {
    if (flush) { this.current?.editor.flush(); }
    this.current?.editor.destroy();
    this.current = null;
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
    const ordered = [...this.notes].sort((a, b) => a.created.localeCompare(b.created) || a.id.localeCompare(b.id));
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

  private open(note: ReaderNote): void {
    if (this.current?.id === note.id) { this.current.editor.focus(); return; }
    this.close();
    const root = renderElement("div", {});
    this.body.replaceChildren(root);
    const body = this.drafts.get(note.id) ?? note.body;
    const editor = mountQmdEditor(root, {
      body,
      onChange: (body) => {
        if (!this.current || this.current.id !== note.id) { return; }
        this.current.latest = body;
        this.drafts.set(note.id, body);
        this.status.textContent = "Saving…";
        this.ctx.host.post({ command: "editNote", id: note.id, body });
      },
      status: this.status,
      ...this.runs.option(note.id, root),
    });
    this.current = { id: note.id, editor, latest: body };
    for (const [id, pin] of this.pins) { pin.setAttribute("aria-expanded", String(id === note.id)); }
    const at = this.position(note);
    this.source.textContent = at ? `Page ${at.page}` : "";
    this.source.hidden = !at;
    this.status.textContent = this.drafts.has(note.id) ? "Saving…" : "Saved";
    this.el.hidden = false;
    this.place();
    editor.focus();
  }

  private place(): void {
    if (!this.current || this.el.hidden) { return; }
    const anchor = this.pins.get(this.current.id) ?? [...document.querySelectorAll<HTMLElement>(".rd-note-box")].find((box) => box.dataset["noteId"] === this.current?.id);
    const pin = anchor?.getBoundingClientRect();
    const box = this.el.getBoundingClientRect();
    const right = pin ? pin.right + 12 : window.innerWidth - box.width - 16;
    const left = pin && right + box.width > window.innerWidth - 8 ? pin.left - box.width - 12 : right;
    this.el.style.left = `${deriveClampedNumber(left, 8, Math.max(8, window.innerWidth - box.width - 8))}px`;
    this.el.style.top = `${deriveClampedNumber(pin?.top ?? 64, 8, Math.max(8, window.innerHeight - box.height - 8))}px`;
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
