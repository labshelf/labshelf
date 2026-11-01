/**
 * The detail pane's shared base: the state it keeps (open tab, citation style, folds, filters) with the data one paper's views
 * render from, the markup pieces every part reuses (sections, fields, icon and copy buttons, muted and loading lines) and
 * the Notes tab's item editors.
 */
import { PAPERS_DIR } from "../../../library/index.js";
import type { AnnotationColor, PaperRecord } from "../../../model/index.js";
import { listPapersUnder, type ListPaper } from "../../listModel.js";
import type { PaperDetails, PaperNoteView, PaperStats, SimilarPaper, TextLayerJobView } from "../../protocol/index.js";
import type { CitationFormat, DetailsTab } from "../../store/index.js";
import type { UiContext } from "../uiContext.js";
import { escapeHtml, renderIcon, type IconName } from "../../../ui/index.js";
import { createDebouncer } from "../../../async/index.js";
import { addNote, editNote } from "../flows/index.js";
import type { QmdViewStatePort } from "../../../qmd/index.js";
import { cellRunInfoOf, type CellLanguage } from "../../../qmd/compute/index.js";
import { createCellRunGroup, createCellsAbove, createEvalMathBridge, mountNoteBar, mountQmdEditor, type CellRunGroup, type CellsAbove, type NoteActions, type OnEvalMath, type QmdEditorHandle } from "../../../qmd/dom/index.js";

export interface PaneState {
  ctx: UiContext;
  el: HTMLElement;
  tab: DetailsTab;
  citeFormat: CitationFormat;
  collapsed: Record<string, boolean>;
  abstractOpen: boolean;
  authorsOpen: boolean;
  annFilter: string;
  annColor: AnnotationColor | null;
  /** The tag row shows its field rather than the Add tag button. */
  tagEditing: boolean;
  /** The selection the pane shows, as sorted ids. */
  key: string;
  /** A render was skipped while the note had focus. */
  stale: boolean;
  notes: NoteEditor;
}

/** Everything a single paper's views read. */
export interface PaperView {
  p: ListPaper;
  stats: PaperStats | undefined;
  details: PaperDetails | undefined;
  job: TextLayerJobView | undefined;
  /** undefined: not asked; null: the host is searching. */
  similar: SimilarPaper[] | null | undefined;
  library: PaperRecord[];
  openFolder: string;
  pdfBusy: boolean;
}

export function derivePaperView(ctx: UiContext, id: string): PaperView | null {
  const s = ctx.store.get();
  const p = listPapersUnder(s.papers, PAPERS_DIR, s.pdfDirs).find((q) => q.id === id);
  if (!p) return null;
  return {
    p, stats: s.stats[id], details: s.details[id], job: s.jobs[id], similar: s.similar[id], library: s.papers,
    openFolder: s.folder, pdfBusy: s.pdfBusy.has(id),
  };
}

export interface SectionOptions {
  count?: number;
}

/** A section, open unless the user folded it. */
export function renderSection(id: string, title: string, body: string, collapsed: Record<string, boolean>, o: SectionOptions = {}): string {
  const closed = !!collapsed[id];
  return `<div class="detail-section">` +
    `<div class="sec-head${closed ? " collapsed" : ""}" data-sec="${id}" role="button" tabindex="0" aria-expanded="${!closed}">` +
      `<span class="sec-chevron">${renderIcon("chevron-down")}</span>` +
      `<span class="sec-title">${escapeHtml(title)}</span>` +
      (o.count ? `<span class="sec-count">${o.count}</span>` : "") +
    `</div>` +
    `<div class="sec-body${closed ? " hidden" : ""}" data-sec-body="${id}">${body}</div></div>`;
}

export function renderField(label: string, valueHtml: string): string {
  return `<div class="kv-label">${escapeHtml(label)}</div><div class="kv-value">${valueHtml}</div>`;
}

export function renderIconButton(action: string, name: IconName, title: string, attrs = ""): string {
  return `<button class="ls-icon-btn" type="button" data-action="${action}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}"${attrs}>${renderIcon(name)}</button>`;
}

export function copyBtn(text: string, label: string): string {
  return renderIconButton("copyField", "copy", `Copy ${label}`, ` data-text="${escapeHtml(text)}" data-label="${escapeHtml(label)}"`);
}

export function renderMuted(text: string): string {
  return `<div class="muted-note">${escapeHtml(text)}</div>`;
}

export function renderLoading(text = "Loading…"): string {
  return `<div class="muted-note pane-loading"><span class="spin">${renderIcon("loader")}</span>${escapeHtml(text)}</div>`;
}

const SAVE_AFTER_MS = 700;

export interface NoteEditor {
  /** The paper's note items, with the text being typed in place of the saved one. */
  items(id: string): PaperNoteView[];
  /** The items' bodies joined by blank lines. */
  text(id: string): string;
  /** Mounts an editor into every `.note-editor` of `root`, and focuses the new-item one when asked to. */
  mount(root: HTMLElement, id: string, readOnly: boolean): void;
  /** Appends `markdown` to the last item, or adds an item holding it. */
  append(id: string, markdown: string): void;
  /** Focuses the empty new item; no item exists until the user types. */
  focusNew(): void;
  /** Saves every draft now. */
  flush(): void;
  dispose(): void;
}

/** The editor options that run and restart a note item's cells. */
interface RunOptions {
  onRunCell: ReturnType<CellRunGroup["attach"]>;
  onRestartCell?(language: CellLanguage): void;
  onEvalMath: OnEvalMath;
  cellsAbove: CellsAbove;
}

/** The run status of each note item, kept across renders so a pushed body does not lose a run in flight. */
interface NoteRuns {
  /**
   * The editor's run options, or undefined when the host cannot run cells; it mounts the item's status row under `editorEl`.
   * `cells` gives the bodies of the items listed before this one and this item's latest body, for the math above the cursor.
   */
  attach(editorEl: HTMLElement, paper: string, itemId: string, cells: { earlier(): readonly string[]; own(): string }): RunOptions | undefined;
  dispose(): void;
}

function createNoteRuns(ctx: UiContext): NoteRuns {
  const group = createCellRunGroup({
    onCancel: (requestId) => ctx.transport.post({ type: "paper.cancelCell", requestId }),
    onInstallPython: () => ctx.transport.post({ type: "paper.installPython" }),
  });
  // A cellState for a request no status started is ignored. Listens only once a status exists.
  const math = createEvalMathBridge();
  let off: (() => void) | null = null;
  const listen = (): void => {
    off ??= ctx.transport.subscribe((m) => { 
      if (m.type === "paper.cellState") group.show(m.requestId, m.state, cellRunInfoOf(m));
      else if (m.type === "paper.cellPreview") group.showPreview(m.requestId, m.result);
      else if (m.type === "paper.mathResult") math.receive(m.requestId, m.result);
    });
  };
  return {
    attach(editorEl, paper, itemId, cells) {
      if (ctx.readOnly || ctx.store.get().details[paper]?.canRunCells !== true) return undefined;
      listen();
      const key = `${paper}\n${itemId}`;
      const onRunCell = group.attach(key, editorEl,
        (label, code, requestId, language, params, preview) => ctx.transport.post({
          type: "paper.runCell", id: paper, itemId, label, code, language, requestId, ...(params ? { params } : {}), ...(preview ? { preview: true } : {}),
        }),
        (language) => ctx.transport.post({ type: "paper.restartCell", id: paper, language }));
      const onRestartCell = group.restartCell(key);
      const onEvalMath = math.forEditor((requestId, request) => ctx.transport.post({ type: "paper.evalMath", id: paper, itemId, requestId, op: request.op, tex: request.tex }));
      const cellsAbove = createCellsAbove(cells.earlier, cells.own);
      return onRestartCell ? { onRunCell, onRestartCell, onEvalMath, cellsAbove } : { onRunCell, onEvalMath, cellsAbove };
    },
    dispose() { off?.(); off = null; group.clear(); math.clear(); },
  };
}

/** Saves the pending drafts before a normal run, so a run that ends before the save keeps its stored output. */
function flushBeforeRun(run: RunOptions | undefined, flush: () => void): RunOptions | undefined {
  const onRunCell = run?.onRunCell;
  if (!run || !onRunCell) return run;
  return { ...run, onRunCell: (label, code, language, params, preview) => { if (!preview) flush(); onRunCell(label, code, language, params, preview); } };
}

/** What ties an item editor to the note bar and to the host's view state: the bar's actions, and the port keyed `${paper}\n${itemId}`. */
interface NoteLinks { noteActions: NoteActions; viewState?: { port: QmdViewStatePort; key: string } }

function mountItemEditor(el: HTMLElement, body: string, readOnly: boolean, onChange: (text: string) => void,
  run: RunOptions | undefined, links: NoteLinks): QmdEditorHandle {
  return mountQmdEditor(el, { body, readOnly, onChange, ...run, ...links });
}

function mountNewItemEditor(ctx: UiContext, el: HTMLElement, paper: string, body: string, readOnly: boolean): QmdEditorHandle {
  let added = false;
  const onChange = (text: string): void => { if (!added && text.trim()) { added = true; addNote(ctx, paper, text); } };
  return mountQmdEditor(el, { body, readOnly, onChange });
}

/** The notes of a paper with the unsaved drafts laid over their bodies. */
function notesWithDrafts(ctx: UiContext, paper: string, drafts: ReadonlyMap<string, { body: string }>): PaperNoteView[] {
  return (ctx.store.get().details[paper]?.notes ?? []).map((n) => (drafts.has(n.id) ? { ...n, body: drafts.get(n.id)!.body } : n));
}

/** Calls `flush` whenever the page becomes hidden; returns the function that stops it. */
function flushWhenHidden(flush: () => void): () => void {
  const onHide = (): void => { if (document.hidden) flush(); };
  document.addEventListener("visibilitychange", onHide);
  return () => document.removeEventListener("visibilitychange", onHide);
}

/** The bodies of the items above one item, and its own current body, for the cells of its editor. */
function noteCells(items: () => PaperNoteView[], itemId: string, fallback: string): { earlier(): readonly string[]; own(): string } {
  return {
    earlier: () => { const all = items(); return all.slice(0, Math.max(all.findIndex((n) => n.id === itemId), 0)).map((n) => n.body); },
    own: () => items().find((n) => n.id === itemId)?.body ?? fallback,
  };
}

/**
 * Mounts the note bar right before the note item holding `firstEditor`. It reads the item editors only on an action, so it can exist before they are
 * mounted; Run all runs their cells in DOM order and never reaches the empty new-item editor.
 */
function mountItemsBar(ctx: UiContext, paper: string, firstEditor: HTMLElement, editors: () => ReadonlyArray<{ itemId: string; handle: QmdEditorHandle }>, flush: () => void) {
  const host = document.createElement("div");
  host.className = "note-bar-host";
  (firstEditor.closest(".note-item") ?? firstEditor).before(host);
  const mounted = mountNoteBar(host, {
    editors,
    flush,
    restart: (language) => { ctx.transport.post({ type: "paper.restartCell", id: paper, language: language as CellLanguage }); return Promise.resolve(); },
    canRun: () => !ctx.readOnly && ctx.store.get().details[paper]?.canRunCells === true,
  });
  return { ...mounted, destroy: () => { mounted.destroy(); host.remove(); } };
}

/** The Notes tab's editors: one `mountQmdEditor` per item and one empty one for a new item, saved after a pause. */
export function createNoteEditor(ctx: UiContext): NoteEditor {
  const drafts = new Map<string, { paper: string; body: string }>();
  let handles: Array<{ itemId: string; handle: QmdEditorHandle }> = [];
  let wantNewFocus = false;
  let bar: { destroy(): void } | null = null;
  const timer = createDebouncer(() => flush(), SAVE_AFTER_MS);
  const runs = createNoteRuns(ctx);
  const items = (id: string): PaperNoteView[] => notesWithDrafts(ctx, id, drafts);
  const flush = (): void => {
    timer.cancel();
    for (const [itemId, d] of drafts) editNote(ctx, d.paper, itemId, d.body);
    drafts.clear();
  };
  const destroy = (): void => { for (const h of handles) h.handle.destroy(); handles = []; bar?.destroy(); bar = null; };
  const stopFlushOnHide = flushWhenHidden(flush);
  return {
    items,
    text: (id) => items(id).map((n) => n.body.trim()).filter(Boolean).join("\n\n"),
    mount(root, id, readOnly) {
      destroy();
      const itemEditors = [...root.querySelectorAll<HTMLElement>(".note-editor")].filter((el) => el.dataset["item"]);
      const noteBar = itemEditors.length ? mountItemsBar(ctx, id, itemEditors[0]!, () => handles.filter((h) => h.itemId !== ""), flush) : null;
      bar = noteBar;
      for (const el of root.querySelectorAll<HTMLElement>(".note-editor")) {
        const itemId = el.dataset["item"];
        const body = itemId ? items(id).find((n) => n.id === itemId)?.body ?? "" : "";
        if (!itemId) {
          const handle = mountNewItemEditor(ctx, el, id, body, readOnly);
          handles.push({ itemId: "", handle });
          if (wantNewFocus) { wantNewFocus = false; handle.focus(); }
          continue;
        }
        const onChange = (text: string): void => { drafts.set(itemId, { paper: id, body: text }); timer.call(); };
        const cells = noteCells(() => items(id), itemId, body);
        const links: NoteLinks = {
          noteActions: noteBar!.actionsFor(itemId),
          ...(ctx.viewState ? { viewState: { port: ctx.viewState, key: `${id}\n${itemId}` } } : {}),
        };
        handles.push({ itemId, handle: mountItemEditor(el, body, readOnly, onChange, readOnly ? undefined : flushBeforeRun(runs.attach(el, id, itemId, cells), flush), links) });
      }
    },
    append(id, markdown) {
      const last = items(id).at(-1);
      if (!last) { addNote(ctx, id, markdown); return; }
      const body = (last.body.trim() ? `${last.body.replace(/\s+$/, "")}\n\n` : "") + markdown;
      drafts.set(last.id, { paper: id, body });
      handles.find((h) => h.itemId === last.id)?.handle.setBody(body);
      flush();
    },
    focusNew() {
      const fresh = handles.find((h) => h.itemId === "");
      if (fresh) fresh.handle.focus(); else wantNewFocus = true;
    },
    flush,
    dispose() { flush(); destroy(); runs.dispose(); stopFlushOnHide(); },
  };
}
