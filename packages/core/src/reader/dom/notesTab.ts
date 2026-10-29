// Renders the Notes tab: the paper's notes grouped by page, filtered, each edited in the core item editor.
import type { Annotation } from "../../model/index.js";
import { createDebouncer, type Debouncer } from "../../async/index.js";
import type { CellRunState } from "../../qmd/compute/index.js";
import { createCellRunGroup, mountQmdEditor, QMD_VOCABULARY, type QmdEditorHandle } from "../../qmd/dom/index.js";
import { parseAnchor } from "../../qmd/item/index.js";
import { renderIcon } from "../../ui/index.js";
import { renderElement } from "../../ui/dom/index.js";
import type { ReaderNote } from "../protocol/index.js";
import { renderReaderIconButton } from "./elements.js";
import type { HostBridge, ReaderContext } from "./readerSession.js";
import type { SidebarPanel } from "./sidebar.js";

/**
 * Lists the paper's notes with a filter; each row has an anchor chip that jumps to its page, an editor and a delete button.
 */

const SAVE_DELAY_MS = 1000;
const UNANCHORED = "Unanchored";

type FilterKind = "all" | "page" | "highlights" | "boxes" | "unanchored";

const FILTERS: ReadonlyArray<{ value: FilterKind; label: string }> = [
  { value: "all", label: "All" },
  { value: "page", label: "This page" },
  { value: "highlights", label: "On highlights" },
  { value: "boxes", label: "Text boxes" },
  { value: "unanchored", label: UNANCHORED },
];

const ITEM = QMD_VOCABULARY.item;
const ITEMS = `${ITEM}s`;
const CAPITAL_ITEMS = `${ITEMS.charAt(0).toUpperCase()}${ITEMS.slice(1)}`;

interface Row {
  readonly el: HTMLElement;
  readonly chipSlot: HTMLElement;
  readonly root: HTMLElement;
  readonly editor: QmdEditorHandle;
  readonly save: Debouncer<[]>;
  readonly remove: HTMLButtonElement;
  /** The body the editor holds. */
  latest: string;
  /** The body the host last had, from a push or from our own edit. */
  sent: string;
  focused: boolean;
  confirming: boolean;
}

interface Placement {
  readonly note: ReaderNote;
  /** The page the note belongs to; null sorts under Unanchored. */
  readonly page: number | null;
  readonly kind: "highlight" | "box" | "none";
  readonly annotation: Annotation | null;
  readonly boxPage: number | null;
}

export class NotesTab implements SidebarPanel {
  readonly el = renderElement("div", { class: "rd-panel rd-notes", role: "tabpanel" });
  /** Called when an added item must be shown; the reader opens the sidebar on this tab. */
  onReveal: (() => void) | null = null;
  private readonly count = renderElement("span", { class: "rd-notes-count" }, "0");
  private readonly select = renderElement("select", { class: "rd-notes-filter", "aria-label": "Show" });
  private readonly search = renderElement("input", {
    class: "rd-notes-search", type: "search", placeholder: `Filter ${ITEMS}`, "aria-label": `Filter ${ITEMS}`,
  });
  private readonly list = renderElement("div", { class: "rd-notes-list" });
  private readonly rows = new Map<string, Row>();
  private readonly headings = new Map<string, HTMLElement>();
  private readonly emptyNone = renderElement("div", { class: "rd-empty" }, `No ${ITEMS} yet. Select text and choose Add to ${ITEM}, or draw a text box.`);
  private readonly emptyMatch = renderElement("div", { class: "rd-empty" }, `No ${ITEMS} match.`);
  private notes: readonly ReaderNote[] = [];
  private annotations: ReadonlyMap<string, Annotation> = new Map();
  private awaitingHighlight = false;
  private focusAnchor: string | null = null;
  private canRunCells = false;
  private readonly runs = createCellRunGroup({
    onCancel: (requestId) => this.host.post({ command: "cancelCell", requestId }),
    onInstallPython: () => this.host.post({ command: "installPython" }),
  });

  constructor(
    private readonly host: HostBridge,
    private readonly goToPage: (page: number) => void,
    private readonly currentPage: () => number,
    eventBus: ReaderContext["eventBus"],
  ) {
    for (const filter of FILTERS) {
      this.select.append(renderElement("option", { value: filter.value }, filter.label));
    }
    const filterRow = renderElement("div", { class: "rd-notes-filters" }, this.select, this.search);
    this.el.append(
      renderElement("div", { class: "rd-panel-header" }, renderElement("span", {}, CAPITAL_ITEMS), this.count),
      filterRow,
      this.list,
    );
    this.select.addEventListener("change", () => this.render());
    this.search.addEventListener("input", () => this.render());
    eventBus.on("pagechanging", () => { if (this.filter() === "page") { this.render(); } });
    this.render();
  }

  onShow(): void { /* always current */ }
  onHide(): void { /* nothing to release */ }

  /**
   * Replaces the paper's annotations, which chips and page groups resolve highlight anchors against.
   * When "Add to note" is waiting for its highlight, the first annotation not seen before gets an item.
   */
  setAnnotations(annotations: readonly Annotation[]): void {
    const previous = this.annotations;
    this.annotations = new Map(annotations.map((a) => [a.id, a]));
    if (this.awaitingHighlight) {
      const added = annotations.find((a) => !previous.has(a.id));
      if (added) {
        this.awaitingHighlight = false;
        this.focusAnchor = `hl:${added.id}`;
        this.host.post({ command: "addNote", anchor: this.focusAnchor, body: "" });
      }
    }
    this.render();
  }

  /**
   * Replaces the paper's notes with the host's list; a row being edited keeps its editor and caret.
   */
  show(notes: readonly ReaderNote[]): void {
    this.notes = notes;
    this.render();
    this.focusPending();
  }

  /** Whether the host can run cells; editors get a Run button only when it can, so a change remounts every row. */
  setCanRunCells(canRun: boolean): void {
    if (canRun === this.canRunCells) { return; }
    this.canRunCells = canRun;
    for (const [id, row] of this.rows) { this.destroyRow(id, row); }
    if (!canRun) { this.runs.clear(); }
    this.render();
  }

  /** Shows the host's state of a run under its editor; a request this tab did not send is ignored. */
  showCellState(requestId: string, state: CellRunState): void { this.runs.show(requestId, state); }

  /**
   * Called by "Add to note": the next new annotation gets an empty item that opens focused.
   */
  expectHighlight(): void { this.awaitingHighlight = true; }

  private filter(): FilterKind { return this.select.value as FilterKind; }

  private focusPending(): void {
    if (this.focusAnchor === null) { return; }
    const note = this.notes.find((n) => n.anchor === this.focusAnchor);
    if (!note) { return; }
    this.focusAnchor = null;
    if (!this.rows.has(note.id) || !this.rows.get(note.id)!.el.isConnected) {
      this.select.value = "all";
      this.search.value = "";
      this.render();
    }
    this.onReveal?.();
    this.rows.get(note.id)?.editor.focus();
  }

  private place(note: ReaderNote): Placement {
    const anchor = parseAnchor(note.anchor);
    if (anchor.kind === "highlight") {
      const annotation = this.annotations.get(anchor.annotationId) ?? null;
      return { note, kind: "highlight", annotation, page: annotation ? annotation.pageNumber : null, boxPage: null };
    }
    if (anchor.kind === "box") {
      return { note, kind: "box", annotation: null, page: anchor.page, boxPage: anchor.page };
    }
    return { note, kind: "none", annotation: null, page: null, boxPage: null };
  }

  private matches(p: Placement, filter: FilterKind, query: string): boolean {
    if (query && !p.note.body.toLowerCase().includes(query)) { return false; }
    switch (filter) {
      case "page": return p.page === this.currentPage();
      case "highlights": return p.kind === "highlight";
      case "boxes": return p.kind === "box";
      case "unanchored": return p.page === null;
      default: return true;
    }
  }

  private render(): void {
    this.count.textContent = String(this.notes.length);
    const filter = this.filter();
    const query = this.search.value.trim().toLowerCase();
    const placed = this.notes.map((note) => this.place(note));
    const visible = placed
      .map((p, index) => ({ p, index }))
      .filter(({ p }) => this.matches(p, filter, query))
      .sort((a, b) => {
        const pa = a.p.page ?? Number.POSITIVE_INFINITY;
        const pb = b.p.page ?? Number.POSITIVE_INFINITY;
        if (pa !== pb) { return pa < pb ? -1 : 1; }
        if (a.p.note.created !== b.p.note.created) { return a.p.note.created < b.p.note.created ? -1 : 1; }
        return a.index - b.index;
      })
      .map(({ p }) => p);

    const wanted = new Set(visible.map((p) => p.note.id));
    for (const [id, row] of this.rows) {
      if (!wanted.has(id) && !row.focused) { this.destroyRow(id, row); }
    }

    const desired: HTMLElement[] = [];
    let group: string | null = null;
    for (const p of visible) {
      const label = p.page === null ? UNANCHORED : `Page ${p.page}`;
      if (label !== group) {
        group = label;
        desired.push(this.heading(label));
      }
      const row = this.rowFor(p.note);
      this.updateRow(row, p);
      desired.push(row.el);
    }
    if (desired.length === 0) { desired.push(this.notes.length === 0 ? this.emptyNone : this.emptyMatch); }
    this.syncChildren(desired);
  }

  private heading(label: string): HTMLElement {
    let el = this.headings.get(label);
    if (!el) {
      el = renderElement("div", { class: "rd-ann-group" }, label);
      this.headings.set(label, el);
    }
    return el;
  }

  // Moves only what is out of place, so a row that keeps its position is never detached while it holds focus.
  private syncChildren(desired: readonly HTMLElement[]): void {
    desired.forEach((el, i) => {
      const at = this.list.children[i] ?? null;
      if (at !== el) { this.list.insertBefore(el, at); }
    });
    while (this.list.children.length > desired.length) { this.list.lastElementChild?.remove(); }
  }

  private rowFor(note: ReaderNote): Row {
    const existing = this.rows.get(note.id);
    if (existing) { return existing; }
    const row = this.createRow(note);
    this.rows.set(note.id, row);
    return row;
  }

  private createRow(note: ReaderNote): Row {
    const chipSlot = renderElement("span", { class: "rd-note-chip-slot" });
    const root = renderElement("div", { class: "rd-note-editor" });
    const remove = renderReaderIconButton(renderIcon("trash"), `Delete ${ITEM}`, "rd-btn-sm rd-note-delete");
    const el = renderElement("div", { class: "rd-note-row", "data-note-id": note.id },
      renderElement("div", { class: "rd-note-head" }, chipSlot, remove), root);
    const save = createDebouncer(() => this.send(row), SAVE_DELAY_MS);
    const row: Row = {
      el, chipSlot, root, remove, save, latest: note.body, sent: note.body, focused: false, confirming: false,
      editor: mountQmdEditor(root, {
        body: note.body,
        onChange: (body) => {
          row.latest = body;
          if (row.focused) { save.call(); } else { this.send(row); }
        },
        ...this.runOption(note.id, root),
      }),
    };
    root.addEventListener("focusin", () => { row.focused = true; });
    root.addEventListener("focusout", (e) => {
      if (e.relatedTarget instanceof Node && root.contains(e.relatedTarget)) { return; }
      row.focused = false;
      save.flush();
    });
    root.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && document.activeElement instanceof HTMLElement) { document.activeElement.blur(); }
    });
    remove.addEventListener("click", () => this.removeClicked(row, note.id));
    remove.addEventListener("blur", () => this.setConfirming(row, false));
    remove.addEventListener("keydown", (e) => { if (e.key === "Escape") { this.setConfirming(row, false); } });
    return row;
  }

  private runOption(itemId: string, root: HTMLElement): { onRunCell?(label: string, code: string): void } {
    if (!this.canRunCells) { return {}; }
    return { onRunCell: this.runs.attach(itemId, root, (label, code, requestId) =>
      this.host.post({ command: "runCell", itemId, label, code, requestId })) };
  }

  private send(row: Row): void {
    if (row.latest === row.sent) { return; }
    const id = this.idOf(row);
    if (id === null) { return; }
    row.sent = row.latest;
    this.host.post({ command: "editNote", id, body: row.latest });
  }

  private idOf(row: Row): string | null {
    return row.el.dataset["noteId"] ?? null;
  }

  private removeClicked(row: Row, id: string): void {
    if (row.latest.trim() === "" || row.confirming) {
      this.host.post({ command: "removeNote", id });
      return;
    }
    this.setConfirming(row, true);
  }

  private setConfirming(row: Row, on: boolean): void {
    row.confirming = on;
    row.remove.classList.toggle("rd-danger", on);
    const label = on ? "Confirm delete" : `Delete ${ITEM}`;
    row.remove.setAttribute("aria-label", label);
    row.remove.title = label;
  }

  private updateRow(row: Row, p: Placement): void {
    if (!row.focused && p.note.body !== row.latest) {
      row.editor.setBody(p.note.body);
      row.latest = p.note.body;
    }
    row.sent = p.note.body;
    row.chipSlot.replaceChildren(...this.chip(p));
  }

  private chip(p: Placement): HTMLElement[] {
    if (p.kind === "highlight" && !p.annotation) {
      return [renderElement("span", { class: "rd-note-chip rd-note-missing", title: "Highlight not found", html: renderIcon("warning") })];
    }
    if (p.page === null) { return []; }
    const page = p.page;
    const content = p.kind === "highlight"
      ? renderElement("span", { class: `rd-ann-dot rd-color-${p.annotation?.color ?? "note"}` })
      : renderElement("span", { class: "rd-note-chip-icon", html: renderIcon("text-box") });
    const chip = renderElement("button", { class: "rd-note-chip", type: "button", title: `Go to page ${page}`, "aria-label": `Go to page ${page}` }, content);
    chip.addEventListener("click", () => this.goToPage(page));
    return [chip];
  }

  private destroyRow(id: string, row: Row): void {
    row.save.cancel();
    row.editor.destroy();
    row.el.remove();
    this.rows.delete(id);
  }
}
