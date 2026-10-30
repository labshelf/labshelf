// Lists compact PDF note previews and opens one full editor at a time, preserving edits through navigation.
import type { Annotation } from "../../model/index.js";
import { createDebouncer, type Debouncer } from "../../async/index.js";
import type { CellRunState } from "../../qmd/compute/index.js";
import { createCellRunGroup, mountQmdEditor, QMD_VOCABULARY, type QmdEditorHandle } from "../../qmd/dom/index.js";
import { parseAnchor, sameItemBody } from "../../qmd/item/index.js";
import { renderIcon } from "../../ui/index.js";
import { renderElement } from "../../ui/dom/index.js";
import type { ReaderNote } from "../protocol/index.js";
import { renderReaderIconButton } from "./elements.js";
import type { HostBridge, ReaderContext } from "./readerSession.js";
import type { SidebarPanel } from "./sidebar.js";

const SAVE_DELAY_MS = 400;
const ITEM = QMD_VOCABULARY.item;
const ITEMS = `${ITEM}s`;
type Filter = "all" | "page" | "highlights" | "boxes" | "unanchored";
interface Placement { page: number | null; label: string; annotation?: Annotation | undefined }
interface ActiveNote { id: string; editor: QmdEditorHandle; root: HTMLElement; latest: string; lastSent: string; save: Debouncer<[]> }
const FILTERS: ReadonlyArray<[Filter, string]> = [["all", "All notes"], ["page", "This page"], ["highlights", "On highlights"], ["boxes", "Text boxes"], ["unanchored", "Unanchored"]];

export class NotesTab implements SidebarPanel {
  readonly el = renderElement("div", { class: "rd-panel rd-notes", role: "tabpanel" });
  onReveal: (() => void) | null = null;
  private readonly count = renderElement("span", { class: "rd-notes-count" }, "0");
  private readonly select = renderElement("select", { class: "rd-notes-filter", "aria-label": "Show" });
  private readonly search = renderElement("input", { class: "rd-notes-search", type: "search", placeholder: `Search ${ITEMS}…`, "aria-label": `Filter ${ITEMS}` });
  private readonly filters = renderElement("div", { class: "rd-notes-filters" }, this.search, this.select);
  private readonly list = renderElement("div", { class: "rd-notes-list", "aria-label": "Notes" });
  private readonly pane = renderElement("div", { class: "rd-notes-editor-pane", hidden: true });
  private readonly status = renderElement("span", { class: "rd-note-save-status", role: "status", "aria-live": "polite" });
  private readonly context = renderElement("div", { class: "rd-note-context" });
  private readonly remove = renderReaderIconButton(renderIcon("trash"), `Delete ${ITEM}`, "rd-btn-sm rd-note-delete");
  private readonly drafts = new Map<string, string>();
  private notes: readonly ReaderNote[] = [];
  private annotations = new Map<string, Annotation>();
  private active: ActiveNote | null = null;
  private confirming = false;
  private listScroll = 0;
  private canRunCells = false;
  private readonly runs = createCellRunGroup({
    onCancel: (requestId) => this.host.post({ command: "cancelCell", requestId }),
    onInstallPython: () => this.host.post({ command: "installPython" }),
  });

  constructor(private readonly host: HostBridge, private readonly goToPage: (page: number) => void, private readonly currentPage: () => number, eventBus: ReaderContext["eventBus"]) {
    for (const [value, label] of FILTERS) { this.select.append(renderElement("option", { value }, label)); }
    this.el.append(renderElement("div", { class: "rd-panel-header" }, renderElement("span", {}, `${ITEMS.charAt(0).toUpperCase()}${ITEMS.slice(1)}`), this.count), this.filters, this.list, this.pane);
    this.select.addEventListener("change", () => this.renderList());
    this.search.addEventListener("input", () => this.renderList());
    this.list.addEventListener("scroll", () => { if (!this.list.hidden) { this.listScroll = this.list.scrollTop; } }, { passive: true });
    eventBus.on("pagechanging", () => { if (this.select.value === "page") { this.renderList(); } });
    this.remove.addEventListener("click", () => this.deleteActive());
    this.remove.addEventListener("blur", () => this.confirmDelete(false));
    this.renderList();
  }

  onShow(): void { this.renderList(); }
  onHide(): void { this.flush(); }

  setAnnotations(annotations: readonly Annotation[]): void {
    this.annotations = new Map(annotations.map((item) => [item.id, item]));
    this.renderList();
    this.renderContext();
  }

  show(notes: readonly ReaderNote[]): void {
    this.active?.editor.flush();
    this.notes = notes;
    for (const [id, body] of this.drafts) {
      const note = notes.find((item) => item.id === id);
      if (!note || sameItemBody(note.body, body)) { this.drafts.delete(id); }
    }
    const active = this.active;
    const stored = notes.find((item) => item.id === active?.id);
    if (active && !stored) { this.closeEditor(false); }
    if (active && stored) {
      if (!this.drafts.has(active.id) && !sameItemBody(active.latest, stored.body)) {
        active.latest = stored.body;
        active.lastSent = stored.body;
        active.editor.setBody(stored.body);
      }
      this.status.textContent = this.drafts.has(active.id) ? "Saving…" : "Saved";
    }
    this.renderList();
    this.renderContext();
  }

  setCanRunCells(canRun: boolean): void {
    if (canRun === this.canRunCells) { return; }
    const id = this.active?.id;
    this.closeEditor();
    this.canRunCells = canRun;
    if (!canRun) { this.runs.clear(); }
    if (id) { this.reveal(id); }
  }

  showCellState(requestId: string, state: CellRunState): void { this.runs.show(requestId, state); }

  /** Opens the selected note; pending edits are sent before another editor is mounted. */
  reveal(id: string, body?: string): void {
    if (this.active?.id === id && body === undefined) { this.onReveal?.(); this.active.editor.focus(); return; }
    if (!this.list.hidden) { this.listScroll = this.list.scrollTop; }
    this.closeEditor();
    const note = this.notes.find((item) => item.id === id);
    if (!note) { return; }
    if (body !== undefined && !sameItemBody(body, note.body)) { this.drafts.set(id, body); }
    const latest = this.drafts.get(id) ?? note.body;
    const root = renderElement("div", { class: "rd-note-editor" });
    const back = renderElement("button", { class: "rd-notes-back", type: "button" }, renderElement("span", { html: renderIcon("arrow-left"), "aria-hidden": "true" }), "All notes");
    back.addEventListener("click", () => this.closeEditor());
    this.pane.replaceChildren(renderElement("div", { class: "rd-notes-editor-nav" }, back, this.remove), this.context, root, renderElement("div", { class: "rd-note-editor-footer" }, this.status));
    const save = createDebouncer(() => this.send(active), SAVE_DELAY_MS);
    const active: ActiveNote = { id, root, latest, lastSent: latest, save, editor: mountQmdEditor(root, {
      body: latest,
      onChange: (next) => { active.latest = next; this.drafts.set(id, next); this.status.textContent = "Saving…"; save.call(); },
      ...this.runOption(id, root),
    }) };
    this.active = active;
    this.confirmDelete(false);
    this.status.textContent = this.drafts.has(id) ? "Saving…" : "Saved";
    this.filters.hidden = this.list.hidden = true;
    this.pane.hidden = false;
    this.renderContext();
    this.onReveal?.();
    active.editor.focus();
  }

  private flush(): void { this.active?.editor.flush(); this.active?.save.flush(); }

  private closeEditor(save = true): void {
    const id = this.active?.id;
    if (save) { this.flush(); }
    this.active?.save.cancel();
    this.active?.editor.destroy();
    this.active = null;
    this.pane.replaceChildren();
    this.pane.hidden = true;
    this.filters.hidden = this.list.hidden = false;
    this.renderList();
    if (save && id) { this.list.querySelectorAll<HTMLButtonElement>(".rd-note-preview").forEach((button) => { if (button.dataset["noteId"] === id) { button.focus({ preventScroll: true }); } }); }
  }

  private send(active: ActiveNote): void {
    if (sameItemBody(active.latest, active.lastSent)) { return; }
    active.lastSent = active.latest;
    this.host.post({ command: "editNote", id: active.id, body: active.latest });
  }

  private place(note: ReaderNote): Placement {
    const anchor = parseAnchor(note.anchor);
    if (anchor.kind === "highlight") {
      const annotation = this.annotations.get(anchor.annotationId);
      return { page: annotation?.pageNumber ?? null, label: annotation ? "On highlight" : "Highlight not found", annotation };
    }
    if (anchor.kind === "point" || anchor.kind === "box") { return { page: anchor.page, label: anchor.kind === "point" ? "Page note" : "Text box" }; }
    return { page: null, label: "Unanchored" };
  }

  private matches(note: ReaderNote): boolean {
    const placement = this.place(note);
    const kind = parseAnchor(note.anchor).kind;
    const query = this.search.value.trim().toLowerCase();
    if (query && !(this.drafts.get(note.id) ?? note.body).toLowerCase().includes(query)) { return false; }
    switch (this.select.value as Filter) {
      case "page": return placement.page === this.currentPage();
      case "highlights": return kind === "highlight";
      case "boxes": return kind === "box";
      case "unanchored": return placement.page === null;
      default: return true;
    }
  }

  private renderList(): void {
    const focused = this.list.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset["noteId"] : undefined;
    this.count.textContent = String(this.notes.length);
    const visible = this.notes.filter((note) => this.matches(note)).sort((a, b) => (this.place(a).page ?? Infinity) - (this.place(b).page ?? Infinity) || a.created.localeCompare(b.created));
    const children: HTMLElement[] = [];
    let previous = "";
    for (const note of visible) {
      const placement = this.place(note);
      const group = placement.page === null ? "Unanchored" : `Page ${placement.page}`;
      if (group !== previous) { children.push(renderElement("div", { class: "rd-notes-group" }, group)); previous = group; }
      children.push(this.preview(note, placement));
    }
    if (!children.length) { children.push(renderElement("p", { class: "rd-empty" }, this.notes.length ? "No notes match your search." : "Your notes will appear here. Use Add note in the reader to start.")); }
    this.list.replaceChildren(...children);
    this.list.scrollTop = this.listScroll;
    if (focused) { children.find((child) => child.dataset["noteId"] === focused)?.focus({ preventScroll: true }); }
  }

  private preview(note: ReaderNote, placement: Placement): HTMLElement {
    const lines = previewLines(this.drafts.get(note.id) ?? note.body);
    const button = renderElement("button", { class: "rd-note-preview", type: "button", "data-note-id": note.id },
      renderElement("span", { class: "rd-note-preview-title" }, lines[0] || "Empty note"),
      renderElement("span", { class: "rd-note-preview-body" }, lines.slice(1).join(" ") || (lines.length ? "" : "Start writing…")),
      renderElement("span", { class: "rd-note-preview-meta" }, placement.annotation ? renderElement("span", { class: `rd-ann-dot rd-color-${placement.annotation.color ?? "note"}` }) : renderElement("span", { html: renderIcon("note"), "aria-hidden": "true" }), placement.label));
    button.addEventListener("click", () => this.reveal(note.id));
    return button;
  }

  private renderContext(): void {
    const note = this.notes.find((item) => item.id === this.active?.id);
    if (!note) { return; }
    const placement = this.place(note);
    const source = renderElement("button", { class: "rd-note-source", type: "button", disabled: placement.page === null }, placement.page === null ? placement.label : `Page ${placement.page} · ${placement.label}`);
    source.addEventListener("click", () => { if (placement.page !== null) { this.goToPage(placement.page); } });
    this.context.replaceChildren(source);
    if (placement.annotation?.content) { this.context.append(renderElement("blockquote", { class: "rd-note-quote" }, placement.annotation.content)); }
  }

  private runOption(itemId: string, root: HTMLElement): { onRunCell?(label: string, code: string): void } {
    if (!this.canRunCells) { return {}; }
    return { onRunCell: this.runs.attach(itemId, root, (label, code, requestId) => this.host.post({ command: "runCell", itemId, label, code, requestId })) };
  }

  private deleteActive(): void {
    if (!this.active) { return; }
    this.active.editor.flush();
    if (this.active.latest.trim() && !this.confirming) { this.confirmDelete(true); return; }
    this.active.save.cancel();
    this.host.post({ command: "removeNote", id: this.active.id });
  }

  private confirmDelete(on: boolean): void {
    this.confirming = on;
    this.remove.classList.toggle("rd-danger", on);
    this.remove.title = on ? "Click again to delete this note" : `Delete ${ITEM}`;
    this.remove.setAttribute("aria-label", this.remove.title);
  }
}

function previewLines(body: string): string[] {
  const first = body.trimStart();
  if (/^(`{3,}|~{3,})/.test(first)) { return ["Code note", body.split(/\r?\n/).filter((line) => !/^\s*(`{3,}|~{3,}|#\|)/.test(line)).join(" ").trim()]; }
  if (first.startsWith("$$")) { return ["Equation note", first.replace(/\$/g, "").trim()]; }
  return body.split(/\r?\n/).filter((line) => line.trim() && !/^\s*(`{3,}|~{3,}|#\|)/.test(line))
    .map((line) => line.replace(/^\s*(#{1,6}\s+|[-*+]\s+|>\s*)/, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[*`]/g, "").trim());
}
