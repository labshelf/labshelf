// Draws page-scaled text-box notes over the PDF and edits each in place: text and math only, its height following the text.
import { ANNOTATION_COLORS, type AnnotationColor } from "../../model/index.js";
import type { CellRunInfo, CellRunState } from "../../qmd/compute/index.js";
import { ReaderCellRuns } from "./cellRuns.js";
import { mountQmdEditor, QMD_VOCABULARY, type QmdEditorHandle } from "../../qmd/dom/index.js";
import { formatAnchor, parseAnchor } from "../../qmd/item/index.js";
import { fitBoxToMinimum, snapBox, type PageRect } from "../textBoxPlacement.js";
import { renderElement } from "../../ui/dom/index.js";
import { renderIcon } from "../../ui/index.js";
import type { ReaderNote } from "../protocol/index.js";
import { renderConfirmDelete, renderReaderIconButton } from "./elements.js";
import { NoteDrafts } from "./noteDrafts.js";
import { derivePageFrame, deriveBoxInPage, type PageFrame } from "./pageHighlights.js";
import type { ReaderContext } from "./readerSession.js";

const LAYER_CLASS = "rd-note-layer";
const DRAFT_CLASS = "rd-box-draft";
const EDITING_CLASS = "rd-note-box-editing";
const ITEM = QMD_VOCABULARY.item;
/** Pointer travel in pixels below which a press on a box counts as a click, which starts editing. */
const DRAG_PX = 4;
/** The smallest box, in ems of its own font: about six characters wide and one line (with its padding) tall. */
const MIN_EM = { w: 6, h: 1.65 };
/** The font size assumed when the box has none computed (no layout). */
const FALLBACK_EM_PX = 12;
/** Elements outside a box that belong to its editing session (menus, dialogs, the formatting bubble); a press there keeps editing on. */
const EDITING_CHROME = ".ls-menu, .ls-quick, .ls-dialog, .ls-scrim, .qmd-bubble, .qmd-plot-preview";

interface BoxRect { page: number; x: number; y: number; w: number; h: number }

interface BoxView {
  id: string;
  rect: BoxRect;
  color: AnnotationColor | undefined;
  readonly el: HTMLElement;
  readonly content: HTMLElement;
  readonly swatch: HTMLElement;
  readonly trash: HTMLButtonElement;
  editor: QmdEditorHandle;
  /** The stored body. */
  body: string;
  /** The body the editor shows: the stored one or the user's latest edit. */
  latest: string;
  editing: boolean;
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
  draft.style.height = `${rect.h * 100}%`;
}

/** Positioned in percent of the page, so the box keeps its place while pdf.js scales the page before re-rendering it; the height follows the text. */
function placeRect(el: HTMLElement, r: PageRect): void {
  el.style.left = `${r.x * 100}%`;
  el.style.top = `${r.y * 100}%`;
  el.style.width = `${r.w * 100}%`;
}

function pageElement(pageNumber: number): HTMLElement | null {
  return document.querySelector<HTMLElement>(`#viewer .page[data-page-number="${pageNumber}"]`);
}

/** The smallest box in page fractions at the box's current font size and page frame. */
function minimumBox(el: HTMLElement, frame: PageFrame): { w: number; h: number } {
  const em = Number.parseFloat(getComputedStyle(el).fontSize) || FALLBACK_EM_PX;
  return { w: (MIN_EM.w * em) / frame.width, h: (MIN_EM.h * em) / frame.height };
}

/** Puts the DOM caret at a viewport point inside `root`, where the browser can tell; ProseMirror then takes it as its selection. */
function placeCaretAt(root: HTMLElement, at: { x: number; y: number }): void {
  const doc = document as Document & {
    caretRangeFromPoint?(x: number, y: number): Range | null;
    caretPositionFromPoint?(x: number, y: number): { offsetNode: Node; offset: number } | null;
  };
  let range = doc.caretRangeFromPoint?.(at.x, at.y) ?? null;
  if (!range) {
    const pos = doc.caretPositionFromPoint?.(at.x, at.y);
    if (pos) { range = document.createRange(); range.setStart(pos.offsetNode, pos.offset); }
  }
  if (!range || !root.contains(range.startContainer)) { return; }
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

export class NoteBoxLayer {
  /** Opens a box's note in the sidebar with the body it shows. */
  onOpenFull: ((id: string, body: string) => void) | null = null;
  private readonly views = new Map<string, BoxView>();
  private readonly drafts: NoteDrafts;
  /** Boxes deleted here and not yet gone from the host's list; they are not drawn again meanwhile. */
  private readonly removing = new Set<string>();
  private editing: BoxView | null = null;
  private pendingOpen: string | null = null;
  /** Runs this surface's note cells; readerUi routes the host's cellPreview to it. */
  readonly runs: ReaderCellRuns;

  constructor(private readonly ctx: Pick<ReaderContext, "eventBus" | "host">) {
    this.runs = new ReaderCellRuns(ctx.host);
    this.drafts = new NoteDrafts(ctx.host);
    // PLATFORM: pdf.js drops unknown page children on every re-render (zoom, scrolling back into view).
    ctx.eventBus.on("textlayerrendered", ({ pageNumber }: { pageNumber: number }) => this.paintPage(pageNumber));
    // A press outside the box being edited ends editing; the editor's own menus and dialogs do not.
    document.addEventListener("pointerdown", (event) => {
      const view = this.editing;
      if (!view || !(event.target instanceof Element) || view.el.contains(event.target) || event.target.closest(EDITING_CHROME)) { return; }
      this.endEdit(view);
    }, true);
  }

  /** Replaces the drawn text boxes; a box being edited keeps its unacknowledged text over the stored one. */
  show(notes: readonly ReaderNote[]): void {
    this.editing?.editor.flush();
    this.drafts.settle(notes);
    for (const id of this.removing) {
      if (!notes.some((note) => note.id === id)) { this.removing.delete(id); }
    }
    const pages = new Set<number>([...this.views.values()].map((v) => v.rect.page));
    const seen = new Set<string>();
    for (const note of notes) {
      const anchor = parseAnchor(note.anchor);
      if (anchor.kind !== "box" || this.removing.has(note.id)) { continue; }
      seen.add(note.id);
      const rect = { page: anchor.page, x: anchor.x, y: anchor.y, w: anchor.w, h: anchor.h };
      pages.add(rect.page);
      const existing = this.views.get(note.id);
      if (existing) {
        existing.rect = rect;
        existing.body = note.body;
        if (this.drafts.takesStored(note.id, existing.latest, note.body)) {
          existing.latest = note.body;
          existing.editor.setBody(note.body);
        }
        this.applyColor(existing, note.color);
      } else {
        this.views.set(note.id, this.create(note.id, rect, note.body, note.color));
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
    if (!this.runs.setCanRun(canRun)) { return; }
    for (const view of this.views.values()) { this.mount(view); }
  }

  /** Shows the host's state of a run under its box editor; a request this layer did not send is ignored. */
  showCellState(requestId: string, state: CellRunState, info?: CellRunInfo): void { this.runs.show(requestId, state, info); }

  /** Starts editing the added box in place once the host confirms it. */
  expectBox(anchor: string): void { this.pendingOpen = anchor; }

  private openPending(notes: readonly ReaderNote[]): void {
    if (this.pendingOpen === null) { return; }
    const note = notes.find((n) => n.anchor === this.pendingOpen);
    const view = note ? this.views.get(note.id) : undefined;
    if (!view) { return; }
    this.pendingOpen = null;
    this.startEdit(view);
  }

  /** Keeps the page's layer and the boxes already in it, so a box being edited keeps its focus; pdf.js' re-render recreates the layer. */
  private paintPage(pageNumber: number): void {
    const page = pageElement(pageNumber);
    if (!page) { return; }
    let layer = page.querySelector<HTMLElement>(`.${LAYER_CLASS}`);
    const views = [...this.views.values()].filter((v) => v.rect.page === pageNumber);
    if (views.length === 0) { layer?.remove(); return; }
    if (!layer) {
      layer = renderElement("div", { class: LAYER_CLASS });
      // Above the text layer so boxes take clicks; the layer itself lets clicks through to the text.
      const textLayer = page.querySelector(".textLayer");
      page.insertBefore(layer, textLayer ? textLayer.nextSibling : null);
    }
    const els = new Set(views.map((v) => v.el));
    for (const child of [...layer.children]) {
      if (!els.has(child as HTMLElement)) { child.remove(); }
    }
    for (const view of views) {
      placeRect(view.el, view.rect);
      if (view.el.parentElement !== layer) {
        layer.append(view.el);
        if (view.editing) { view.editor.focus(); }
      }
    }
  }

  private create(id: string, rect: BoxRect, body: string, color: AnnotationColor | undefined): BoxView {
    const content = renderElement("div", { class: "rd-note-box-content" });
    const resize = renderElement("div", { class: "rd-note-box-resize", "aria-hidden": "true", title: "Drag to change the width" });
    const el = renderElement("div", {
      class: "rd-note-box", tabindex: "0", role: "group", "data-note-id": id,
      "aria-label": `${capital(ITEM)} on page ${rect.page}: Enter edits, Delete removes`,
    }, content);
    const swatch = renderElement("span", { class: "rd-annotation-swatch", "aria-hidden": "true" });
    const view: BoxView = {
      id, rect, color: undefined, el, content, swatch, body, latest: body, editing: false,
      trash: renderConfirmDelete({
        label: `Delete ${ITEM}`, confirmLabel: `Click again to delete this ${ITEM}`, extraClass: "rd-note-box-delete",
        hasText: () => Boolean(view.latest.trim()), remove: () => this.remove(view), alsoCancelOn: [el],
      }),
      editor: mountQmdEditor(content, this.editorOptions(id, content, body, false, () => undefined)),
    };
    // The content is in the box before its editor mounts, so a cell's run status row lands beside it.
    el.append(this.renderActions(view), resize);
    this.applyColor(view, color);
    el.addEventListener("keydown", (e) => this.keyDown(view, e));
    el.addEventListener("focusout", (e) => {
      const next = e.relatedTarget;
      if (view.editing && next instanceof Element && !el.contains(next) && !next.closest(EDITING_CHROME)) { this.endEdit(view); }
    });
    this.bindPointer(view);
    return view;
  }

  /** The hover and focus actions: colour, Open in sidebar and Delete. */
  private renderActions(view: BoxView): HTMLElement {
    const colors = renderElement("div", { class: "rd-note-box-colors", role: "group", "aria-label": "Box colour", hidden: true });
    for (const color of ["", ...ANNOTATION_COLORS] as const) {
      const label = color ? `Colour ${color}` : "No colour";
      const button = renderElement("button", { class: `rd-color-btn rd-color-${color || "none"}`, type: "button", title: label, "aria-label": label });
      button.addEventListener("click", () => { colors.hidden = true; this.setColor(view, color || undefined); });
      colors.append(button);
    }
    const palette = renderElement("button", { class: "rd-btn rd-btn-sm rd-note-box-palette", type: "button", title: "Box colour", "aria-label": "Box colour", "aria-haspopup": "true" }, view.swatch);
    palette.addEventListener("click", () => { colors.hidden = !colors.hidden; });
    const open = renderReaderIconButton(renderIcon("external"), "Open in sidebar", "rd-btn-sm rd-note-box-open");
    open.addEventListener("click", () => {
      const body = view.latest;
      this.endEdit(view);
      if (this.views.has(view.id)) { this.onOpenFull?.(view.id, body); }
    });
    return renderElement("div", { class: "rd-note-box-actions" }, palette, colors, open, view.trash);
  }

  private editorOptions(id: string, root: HTMLElement, body: string, editable: boolean, onChange: (body: string) => void): Parameters<typeof mountQmdEditor>[1] {
    // Only text and math in a box; an existing body with cells still renders them. The placeholder shows only while editing.
    return { body, readOnly: !editable, blocks: "text", placeholder: editable ? "Type…" : "", onChange, ...this.runs.option(id, root) };
  }

  /** Mounts the box's editor again, editable while the box is being edited. */
  private mount(view: BoxView): void {
    view.editor.destroy();
    view.editor = mountQmdEditor(view.content, this.editorOptions(view.id, view.content, view.latest, view.editing, (body) => {
      if (!view.editing) { return; }
      view.latest = body;
      this.drafts.save(view.id, body);
    }));
  }

  private startEdit(view: BoxView, at?: { x: number; y: number }): void {
    if (this.editing === view) { view.editor.focus(); return; }
    if (this.editing) { this.endEdit(this.editing); }
    view.editing = true;
    this.editing = view;
    view.el.classList.add(EDITING_CLASS);
    this.mount(view);
    view.editor.focus();
    if (at) { placeCaretAt(view.content, at); }
  }

  /** Saves the text and stops editing; a box left empty is deleted, else its grown or shrunk height is stored. */
  private endEdit(view: BoxView): void {
    if (!view.editing) { return; }
    view.editor.flush();
    view.editing = false;
    if (this.editing === view) { this.editing = null; }
    view.el.classList.remove(EDITING_CLASS);
    if (!view.latest.trim()) { this.remove(view); return; }
    this.mount(view);
    this.persist(view, view.rect);
  }

  private keyDown(view: BoxView, e: KeyboardEvent): void {
    if (e.target === view.el) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); this.startEdit(view); }
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); view.trash.click(); }
      return;
    }
    // An equation's or a cell's own field takes Escape first.
    if (e.key === "Escape" && view.editing && !(e.target instanceof Element && e.target.closest(".qmd-math-edit, .qmd-cell-code"))) {
      e.preventDefault();
      e.stopPropagation();
      this.endEdit(view);
      view.el.focus();
    }
  }

  private setColor(view: BoxView, color: AnnotationColor | undefined): void {
    if (view.color === color) { return; }
    this.applyColor(view, color);
    this.ctx.host.post({ command: "colorNote", id: view.id, color: color ?? "" });
  }

  private applyColor(view: BoxView, color: AnnotationColor | undefined): void {
    if (view.color) { view.el.classList.remove(`rd-color-${view.color}`); }
    view.color = color;
    view.el.classList.toggle("rd-note-box-tinted", color !== undefined);
    if (color) { view.el.classList.add(`rd-color-${color}`); }
    view.swatch.className = `rd-annotation-swatch rd-color-${color ?? "none"}`;
  }

  /** Deletes the box's note now; the box is not drawn again while the host's list still has it. */
  private remove(view: BoxView): void {
    if (this.editing === view) { this.editing = null; }
    this.removing.add(view.id);
    this.drafts.delete(view.id);
    this.destroy(view);
    this.ctx.host.post({ command: "removeNote", id: view.id });
  }

  private destroy(view: BoxView): void {
    if (this.editing === view) { this.editing = null; }
    view.editor.destroy();
    view.el.remove();
    this.runs.drop(view.id);
    this.views.delete(view.id);
  }

  /**
   * Places the box at `base`, then stores it with the height its text takes (kept on the page and at least the minimum)
   * through `moveNote` when that differs from the stored rect.
   */
  private persist(view: BoxView, base: PageRect): void {
    const page = pageElement(view.rect.page);
    const frame = page && derivePageFrame(page);
    if (!frame) { return; }
    placeRect(view.el, base);
    const height = view.el.getBoundingClientRect().height / frame.height;
    const next = fitBoxToMinimum({ ...base, h: height > 0 ? Math.min(height, 1 - base.y) : base.h }, minimumBox(view.el, frame));
    const { rect } = view;
    if ([next.x - rect.x, next.y - rect.y, next.w - rect.w, next.h - rect.h].every((d) => Math.abs(d) < 1e-4)) { placeRect(view.el, rect); return; }
    let anchor: string;
    try {
      anchor = formatAnchor({ kind: "box", page: rect.page, ...next });
    } catch {
      // A rect that is no valid anchor is not stored; the box stays where it was.
      placeRect(view.el, rect);
      return;
    }
    view.rect = { page: rect.page, ...next };
    placeRect(view.el, view.rect);
    this.ctx.host.post({ command: "moveNote", id: view.id, anchor });
  }

  /**
   * Outside editing, dragging the box moves it and dragging its corner changes its width (never below the minimum); a press
   * without travel starts editing at that point. While editing, the pointer selects text.
   */
  private bindPointer(view: BoxView): void {
    view.el.addEventListener("pointerdown", (down) => {
      if (down.button !== 0 || view.editing || !(down.target instanceof Element)) { return; }
      if (down.target.closest(".rd-note-box-actions, a, button, input, textarea")) { return; }
      const resizing = down.target.closest(".rd-note-box-resize") !== null;
      const page = pageElement(view.rect.page);
      const frame = page && derivePageFrame(page);
      if (!page || !frame) { return; }
      down.preventDefault();
      down.stopPropagation();
      const measured = view.el.getBoundingClientRect().height / frame.height;
      const start = { ...view.rect, h: measured > 0 ? Math.min(measured, 1 - view.rect.y) : view.rect.h };
      const min = minimumBox(view.el, frame);
      const rects = collectPageRects(page, view.id);
      let draft: PageRect | null = null;
      const onMove = (e: PointerEvent): void => {
        if (draft === null && Math.hypot(e.clientX - down.clientX, e.clientY - down.clientY) < DRAG_PX) { return; }
        const dx = (e.clientX - down.clientX) / frame.width;
        const dy = (e.clientY - down.clientY) / frame.height;
        draft = resizing
          ? { x: start.x, y: start.y, w: clamp(start.w + dx, Math.min(min.w, 1 - start.x), 1 - start.x), h: start.h }
          : { x: clamp(start.x + dx, 0, 1 - start.w), y: clamp(start.y + dy, 0, 1 - start.h), w: start.w, h: start.h };
        showDraft(page, draft);
      };
      const onUp = (up: PointerEvent): void => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        showDraft(page, null);
        if (!draft) {
          if (!resizing) { this.startEdit(view, { x: up.clientX, y: up.clientY }); }
          return;
        }
        const snapped = snapBox(draft, rects);
        // Snapping may shrink a box off nearby text; the width never goes below the minimum, and a resize keeps the left edge.
        const next = resizing
          ? { ...draft, w: Math.max(snapped.x + snapped.w - draft.x, min.w) }
          : { ...draft, x: snapped.x, y: snapped.y, w: Math.max(snapped.w, min.w) };
        this.persist(view, fitBoxToMinimum(next, min));
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
