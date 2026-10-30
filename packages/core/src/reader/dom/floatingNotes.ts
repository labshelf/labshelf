// Opens anchored PDF notes in a floating rich editor and draws their page pins independently of highlights.
import type { Annotation } from "../../model/index.js";
import { mountQmdEditor, type QmdEditorHandle } from "../../qmd/dom/index.js";
import { formatAnchor, parseAnchor } from "../../qmd/item/index.js";
import { renderElement, renderIcon } from "../../ui/dom/index.js";
import type { ReaderNote } from "../protocol/index.js";
import { deriveClampedNumber, renderReaderIconButton } from "./elements.js";
import type { ReaderContext } from "./readerSession.js";

interface NotePosition { page: number; x: number; y: number }
interface OpenNote { id: string; editor: QmdEditorHandle; root: HTMLElement; latest: string; sent: string }

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

  constructor(private readonly ctx: ReaderContext, private readonly openFull: (id: string, body: string) => void) {
    const close = renderReaderIconButton(renderIcon("x"), "Close note");
    close.addEventListener("click", () => { const id = this.current?.id; this.close(); if (id) { this.pins.get(id)?.focus(); } });
    const full = renderElement("button", { class: "rd-floating-note-full", type: "button" }, renderElement("span", { html: renderIcon("external"), "aria-hidden": "true" }), "Open full note");
    full.addEventListener("click", () => this.revealFull());
    this.source.addEventListener("click", () => {
      const note = this.notes.find((item) => item.id === this.current?.id);
      const at = note && this.position(note);
      if (at) { ctx.pdfViewer.currentPageNumber = at.page; }
    });
    this.el.append(renderElement("header", { class: "rd-floating-note-header" }, renderElement("span", { class: "rd-floating-note-title" }, renderElement("span", { html: renderIcon("note"), "aria-hidden": "true" }), "Paper note"), full, close), this.source, this.body,
      renderElement("footer", { class: "rd-floating-note-footer" }, this.status));
    document.body.append(this.el);
    ctx.eventBus.on("textlayerrendered", () => this.paint());
    ctx.container.addEventListener("scroll", () => this.place(), { passive: true });
    window.addEventListener("resize", () => this.place());
    this.el.addEventListener("keydown", (event) => { if (event.key === "Escape") { event.stopPropagation(); close.click(); } });
    document.addEventListener("pointerdown", (event) => {
      if (this.current && event.target instanceof Element && !this.el.contains(event.target) && !event.target.closest(".rd-note-pin, .ls-menu, .ls-quick, .ls-dialog, .ls-scrim")) { this.close(); }
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
    this.paint();
  }

  show(notes: readonly ReaderNote[]): void {
    this.notes = notes;
    for (const [id, body] of this.drafts) {
      const stored = notes.find((note) => note.id === id);
      if (!stored || sameBody(stored.body, body)) { this.drafts.delete(id); }
    }
    const current = this.current;
    const stored = notes.find((item) => item.id === current?.id);
    if (current && !stored) { this.close(false); }
    if (current && stored) {
      if (sameBody(current.latest, current.sent) && !current.root.contains(document.activeElement)) {
        current.latest = stored.body;
        current.editor.setBody(stored.body);
      }
      current.sent = stored.body;
      this.status.textContent = sameBody(current.latest, stored.body) ? "Saved" : "Saving…";
    }
    this.paint();
    const pending = this.pending;
    const added = pending && notes.find((item) => item.anchor === pending.anchor && !pending.known.has(item.id));
    if (added) { this.pending = null; this.open(added); }
  }

  close(flush = true): void {
    if (flush) { this.current?.editor.flush(); }
    this.current?.editor.destroy();
    this.current = null;
    this.el.hidden = true;
  }

  private create(anchor: string): void {
    this.pending = { anchor, known: new Set(this.notes.map((item) => item.id)) };
    this.ctx.host.post({ command: "addNote", anchor, body: "" });
  }

  private position(note: ReaderNote): NotePosition | null {
    const anchor = parseAnchor(note.anchor);
    if (anchor.kind === "point") { return anchor; }
    const mark = anchor.kind === "highlight" ? this.annotations.get(anchor.annotationId) : undefined;
    return mark?.position ? { page: mark.pageNumber, x: Math.min(1, mark.position.x + mark.position.width + 0.012), y: mark.position.y + mark.position.height / 2 } : null;
  }

  private paint(): void {
    for (const pin of this.pins.values()) { pin.remove(); }
    this.pins.clear();
    for (const note of this.notes) {
      const at = this.position(note);
      const page = at && document.querySelector<HTMLElement>(`#viewer .page[data-page-number="${at.page}"]`);
      if (!page || !at) { continue; }
      const pin = renderReaderIconButton(renderIcon("note"), `Open note on page ${at.page}`, "rd-note-pin");
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
    });
    this.current = { id: note.id, root, editor, latest: body, sent: note.body };
    const at = this.position(note);
    this.source.textContent = at ? `↗ Page ${at.page}` : "Paper note";
    this.status.textContent = this.drafts.has(note.id) ? "Saving…" : "Saved";
    this.el.hidden = false;
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

  private revealFull(): void {
    const current = this.current;
    if (!current) { return; }
    current.editor.flush();
    const { id, latest } = current;
    this.close();
    this.openFull(id, latest);
  }
}


// CONTRACT: documents/contracts/qmd-items.md#items — the host normalizes line endings and appends a missing final newline.
function sameBody(a: string, b: string): boolean {
  const canonical = (text: string): string => text.replace(/\r\n|\r/g, "\n").replace(/([^\n])$/, "$1\n");
  return canonical(a) === canonical(b);
}
