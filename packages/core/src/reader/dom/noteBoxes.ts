// Draws the paper's text-box notes over their rendered pages: clipped read-only content that expands on click to edit.
import type { CellRunState } from "../../qmd/compute/index.js";
import { createCellRunGroup, mountQmdEditor, QMD_VOCABULARY, type QmdEditorHandle } from "../../qmd/dom/index.js";
import { formatAnchor, parseAnchor } from "../../qmd/item/index.js";
import { snapBox, type PageRect } from "../textBoxPlacement.js";
import { renderElement } from "../../ui/dom/index.js";
import type { ReaderNote } from "../protocol/index.js";
import { derivePageFrame, deriveBoxInPage } from "./pageHighlights.js";
import type { ReaderContext } from "./readerSession.js";

const LAYER_CLASS = "rd-note-layer";
const DRAFT_CLASS = "rd-box-draft";
// The editor reports changes after 300 ms; collapsing waits for that last report before remounting read-only.
const SETTLE_MS = 350;
const ITEM = QMD_VOCABULARY.item;

interface BoxRect { page: number; x: number; y: number; w: number; h: number }

interface BoxView {
  id: string;
  rect: BoxRect;
  readonly el: HTMLElement;
  readonly content: HTMLElement;
  editor: QmdEditorHandle;
  open: boolean;
  /** The body the editor holds. */
  latest: string;
  /** The body the host last had. */
  sent: string;
  settle: ReturnType<typeof setTimeout> | null;
}

/** Text and other boxes of a page in page fractions, the obstacles `fitEmptyBox` and `snapBox` place around. */
export function collectPageRects(page: HTMLElement, exceptId?: string): PageRect[] {
  const frame = derivePageFrame(page);
  if (!frame) { return []; }
  const rects: PageRect[] = [];
  const add = (r: DOMRect): void => {
    const b = deriveBoxInPage(r, frame);
    if (b) { rects.push({ x: b.x, y: b.y, w: b.width, h: b.height }); }
  };
  for (const span of page.querySelectorAll<HTMLElement>(".textLayer span")) {
    if (span.childElementCount === 0 && span.textContent?.trim()) { add(span.getBoundingClientRect()); }
  }
  for (const box of page.querySelectorAll<HTMLElement>(`.${LAYER_CLASS} .rd-note-box`)) {
    if (box.dataset["noteId"] !== exceptId) { add(box.getBoundingClientRect()); }
  }
  return rects;
}

/** Shows or moves the dashed draft rectangle over a page; null removes it. */
export function showDraft(page: HTMLElement, rect: PageRect | null): void {
  let draft = page.querySelector<HTMLElement>(`.${DRAFT_CLASS}`);
  if (!rect) { draft?.remove(); return; }
  if (!draft) {
    draft = renderElement("div", { class: DRAFT_CLASS });
    page.append(draft);
  }
  placeRect(draft, rect);
}

/** Positioned in percent of the page, so the box keeps its place while pdf.js scales the page before re-rendering it. */
function placeRect(el: HTMLElement, r: PageRect): void {
  el.style.left = `${r.x * 100}%`;
  el.style.top = `${r.y * 100}%`;
  el.style.width = `${r.w * 100}%`;
  el.style.height = `${r.h * 100}%`;
}

function pageElement(pageNumber: number): HTMLElement | null {
  return document.querySelector<HTMLElement>(`#viewer .page[data-page-number="${pageNumber}"]`);
}

export class NoteBoxLayer {
  private readonly views = new Map<string, BoxView>();
  private pendingOpen: string | null = null;
  private canRunCells = false;
  private readonly runs = createCellRunGroup({
    onCancel: (requestId) => this.ctx.host.post({ command: "cancelCell", requestId }),
    onInstallPython: () => this.ctx.host.post({ command: "installPython" }),
  });

  constructor(private readonly ctx: Pick<ReaderContext, "eventBus" | "host">) {
    // PLATFORM: pdf.js drops unknown page children on every re-render (zoom, scrolling back into view).
    ctx.eventBus.on("textlayerrendered", ({ pageNumber }: { pageNumber: number }) => this.paintPage(pageNumber));
    document.addEventListener("pointerdown", (e) => {
      for (const view of this.views.values()) {
        if (view.open && !(e.target instanceof Node && view.el.contains(e.target))) { this.collapse(view); }
      }
    }, true);
  }

  /** Replaces the drawn boxes with the text-box notes of `notes`; a box being edited keeps its editor. */
  show(notes: readonly ReaderNote[]): void {
    const pages = new Set<number>([...this.views.values()].map((v) => v.rect.page));
    const seen = new Set<string>();
    for (const note of notes) {
      const anchor = parseAnchor(note.anchor);
      if (anchor.kind !== "box") { continue; }
      seen.add(note.id);
      const rect = { page: anchor.page, x: anchor.x, y: anchor.y, w: anchor.w, h: anchor.h };
      pages.add(rect.page);
      const existing = this.views.get(note.id);
      if (existing) {
        existing.rect = rect;
        // An unsent local edit (being settled, or not yet sent) wins over the host body; the settle step then sends it.
        const unsentEdit = existing.settle !== null || existing.latest !== existing.sent;
        existing.sent = note.body;
        if (!unsentEdit && !existing.open && note.body !== existing.latest) {
          existing.latest = note.body;
          existing.editor.setBody(note.body);
        }
      } else {
        this.views.set(note.id, this.create(note.id, rect, note.body));
      }
    }
    for (const [id, view] of this.views) {
      if (!seen.has(id)) { this.destroy(view); }
    }
    for (const page of pages) { this.paintPage(page); }
    this.openPending(notes);
  }

  /** Whether the host can run cells; editors get a Run button only when it can, so a change remounts every box editor. */
  setCanRunCells(canRun: boolean): void {
    if (canRun === this.canRunCells) { return; }
    this.canRunCells = canRun;
    if (!canRun) { this.runs.clear(); }
    for (const view of this.views.values()) { this.mount(view, !view.open); }
  }

  /** Shows the host's state of a run under its box editor; a request this layer did not send is ignored. */
  showCellState(requestId: string, state: CellRunState): void { this.runs.show(requestId, state); }

  /** The note added with `anchor` opens expanded with focus once the host lists it. */
  expectBox(anchor: string): void { this.pendingOpen = anchor; }

  private openPending(notes: readonly ReaderNote[]): void {
    if (this.pendingOpen === null) { return; }
    const note = notes.find((n) => n.anchor === this.pendingOpen);
    const view = note ? this.views.get(note.id) : undefined;
    if (!view) { return; }
    this.pendingOpen = null;
    this.expand(view);
  }

  private paintPage(pageNumber: number): void {
    const page = pageElement(pageNumber);
    if (!page) { return; }
    page.querySelector(`.${LAYER_CLASS}`)?.remove();
    const views = [...this.views.values()].filter((v) => v.rect.page === pageNumber);
    if (views.length === 0) { return; }
    const layer = renderElement("div", { class: LAYER_CLASS });
    for (const view of views) {
      this.place(view);
      layer.append(view.el);
    }
    // Above the text layer so boxes take clicks; the layer itself lets clicks through to the text.
    const textLayer = page.querySelector(".textLayer");
    page.insertBefore(layer, textLayer ? textLayer.nextSibling : null);
    requestAnimationFrame(() => { for (const view of views) { this.measure(view); } });
  }

  private place(view: BoxView): void {
    placeRect(view.el, view.rect);
    if (view.open) {
      view.el.style.height = "auto";
      view.el.style.minHeight = `${view.rect.h * 100}%`;
      view.el.style.maxHeight = `${(1 - view.rect.y) * 100}%`;
    } else {
      view.el.style.removeProperty("min-height");
      view.el.style.removeProperty("max-height");
    }
  }

  private measure(view: BoxView): void {
    const clipped = !view.open && view.content.scrollHeight > view.content.clientHeight + 1;
    view.el.classList.toggle("rd-note-box-clipped", clipped);
  }

  private create(id: string, rect: BoxRect, body: string): BoxView {
    const content = renderElement("div", { class: "rd-note-box-content" });
    const moveStrip = renderElement("div", { class: "rd-note-box-move", "aria-hidden": "true" });
    const resize = renderElement("div", { class: "rd-note-box-resize", "aria-hidden": "true" });
    const el = renderElement("div", {
      class: "rd-note-box", tabindex: "0", role: "button", "data-note-id": id, "aria-label": `${capital(ITEM)} on page ${rect.page}`,
    }, moveStrip, content, resize);
    const view: BoxView = {
      id, rect, el, content, open: false, latest: body, sent: body, settle: null,
      editor: mountQmdEditor(content, { body, readOnly: true, onChange: () => undefined, ...this.runOption(id, content) }),
    };
    el.addEventListener("click", (e) => {
      if (!view.open && !(e.target instanceof Element && e.target.closest(".rd-note-box-move, .rd-note-box-resize"))) { this.expand(view); }
    });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && view.open) {
        e.stopPropagation();
        this.collapse(view);
        el.focus();
      } else if ((e.key === "Enter" || e.key === " ") && !view.open && e.target === el) {
        e.preventDefault();
        this.expand(view);
      }
    });
    this.bindDrag(view, moveStrip, "move");
    this.bindDrag(view, resize, "resize");
    return view;
  }

  private mount(view: BoxView, readOnly: boolean): void {
    view.editor.destroy();
    view.editor = mountQmdEditor(view.content, {
      body: view.latest,
      readOnly,
      onChange: (body) => { view.latest = body; },
      ...this.runOption(view.id, view.content),
    });
  }

  private runOption(itemId: string, content: HTMLElement): { onRunCell?(label: string, code: string): void } {
    if (!this.canRunCells) { return {}; }
    return { onRunCell: this.runs.attach(itemId, content, (label, code, requestId) =>
      this.ctx.host.post({ command: "runCell", itemId, label, code, requestId })) };
  }

  private expand(view: BoxView): void {
    if (view.settle !== null) { clearTimeout(view.settle); view.settle = null; }
    if (!view.open) {
      view.open = true;
      view.el.classList.add("rd-note-box-open");
      view.el.classList.remove("rd-note-box-clipped");
      this.place(view);
      this.mount(view, false);
    }
    view.editor.focus();
  }

  private collapse(view: BoxView): void {
    if (!view.open) { return; }
    view.open = false;
    view.el.classList.remove("rd-note-box-open");
    this.place(view);
    // Waits for the editor's last debounced change, which `destroy` would drop.
    view.settle = setTimeout(() => {
      view.settle = null;
      if (view.open) { return; }
      if (view.latest !== view.sent) {
        view.sent = view.latest;
        this.ctx.host.post({ command: "editNote", id: view.id, body: view.latest });
      }
      this.mount(view, true);
      this.measure(view);
    }, SETTLE_MS);
  }

  private destroy(view: BoxView): void {
    if (view.settle !== null) { clearTimeout(view.settle); }
    if (view.latest !== view.sent) { this.ctx.host.post({ command: "editNote", id: view.id, body: view.latest }); }
    view.editor.destroy();
    view.el.remove();
    this.runs.drop(view.id);
    this.views.delete(view.id);
  }

  /** Dragging the top strip moves the box, the corner resizes it; release sends `moveNote` with the snapped rect. */
  private bindDrag(view: BoxView, handle: HTMLElement, kind: "move" | "resize"): void {
    handle.addEventListener("pointerdown", (down) => {
      if (down.button !== 0) { return; }
      const page = pageElement(view.rect.page);
      const frame = page && derivePageFrame(page);
      if (!page || !frame) { return; }
      down.preventDefault();
      down.stopPropagation();
      const start = { ...view.rect };
      const rects = collectPageRects(page, view.id);
      let draft: PageRect | null = null;
      const onMove = (e: PointerEvent): void => {
        const dx = (e.clientX - down.clientX) / frame.width;
        const dy = (e.clientY - down.clientY) / frame.height;
        draft = kind === "move"
          ? { x: clamp(start.x + dx, 0, 1 - start.w), y: clamp(start.y + dy, 0, 1 - start.h), w: start.w, h: start.h }
          : { x: start.x, y: start.y, w: clamp(start.w + dx, 0.01, 1 - start.x), h: clamp(start.h + dy, 0.01, 1 - start.y) };
        showDraft(page, draft);
      };
      const onUp = (): void => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        showDraft(page, null);
        if (!draft) { return; }
        const snapped = snapBox(draft, rects);
        try {
          const anchor = formatAnchor({ kind: "box", page: view.rect.page, ...snapped });
          view.rect = { page: view.rect.page, ...snapped };
          this.place(view);
          this.measure(view);
          this.ctx.host.post({ command: "moveNote", id: view.id, anchor });
        } catch {
          // A snapped box with no area is not a valid anchor; the box stays where it was.
        }
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function capital(word: string): string {
  return `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
}
