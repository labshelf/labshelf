/**
 * Renders the paper list: column heads and one row per paper in scope, kept in step by id so a refresh rebuilds
 * only the rows that changed. Selection changes repaint classes only, so scroll position and focus survive.
 */
import { PAPERS_DIR, folderLabel } from "../../../library/index.js";
import { nextStatus, type PaperRecord } from "../../../model/index.js";
import { deriveListView, type ListPaper } from "../../derive/index.js";
import { tagQuery } from "../../searchQueries.js";
import { endPaperDrag, startPaperDrag } from "../dnd/index.js";
import { openPaper, requestAddPaper, setPaperStatus } from "../flows/index.js";
import { showPaperMenu } from "../menu/index.js";
import { overlayOpen, type ListCursor, type UiContext } from "../uiContext.js";
import { COLUMN_HEADS_HTML, paintColumnHeads, wireColumnHeads } from "./columnHeads.js";
import { buildEmptyState, buildLoading } from "./emptyState.js";
import { attachListKeys } from "./listKeys.js";
import { buildPaperRow, type RowHandlers, type RowView } from "./paperRow.js";
import { RowReconciler } from "./rowReconciler.js";

interface List {
  ctx: UiContext;
  el: HTMLElement;
  heads: HTMLElement;
  rows: RowReconciler<ListPaper>;
  order: string[];
  expanded: Set<string>;
  lastFolder: string | null;
  /** What the rows of the current render are built from. */
  terms: string[];
  records: Map<string, PaperRecord>;
}

function rowView(list: List, p: ListPaper): RowView {
  const s = list.ctx.store.get();
  return { terms: list.terms, stats: s.stats[p.id], job: s.jobs[p.id], textLayer: !!list.ctx.caps.textLayer };
}

function rowHandlers(list: List): RowHandlers {
  const { ctx } = list;
  return {
    onClick: (id, e) => {
      if (e.shiftKey && ctx.store.get().anchor) ctx.store.selectRange(list.order, id);
      else if (e.metaKey || e.ctrlKey) ctx.store.toggleSelected(id);
      else ctx.store.selectOnly(id);
    },
    onOpen: (id) => openPaper(ctx, id),
    onCycleStatus: (p) => setPaperStatus(ctx, [p.id], nextStatus(p.status)),
    onOpenFolder: (folder) => ctx.store.openFolder(folder),
    onSearchTag: (tag) => ctx.store.set({ status: "all", query: tagQuery(tag) }),
    onMenu: (id, e) => {
      if (!ctx.store.get().selected.has(id)) ctx.store.selectOnly(id);
      showPaperMenu(ctx, { x: e.clientX, y: e.clientY });
    },
    onDragStart: (id, e) => {
      if (!ctx.store.get().selected.has(id)) ctx.store.selectOnly(id);
      const ids = [...ctx.store.get().selected];
      startPaperDrag(ctx, e, ids, ctx.store.get().papers.find((p) => p.id === id)?.title ?? id);
      list.el.querySelectorAll<HTMLElement>(".paper-row").forEach((r) => r.classList.toggle("dragging", ids.includes(r.dataset["id"] ?? "")));
    },
    onDragEnd: () => { endPaperDrag(ctx); list.el.querySelectorAll(".dragging").forEach((r) => r.classList.remove("dragging")); },
    isExpanded: (id) => list.expanded.has(id),
    setExpanded: (id, open) => { if (open) list.expanded.add(id); else list.expanded.delete(id); },
  };
}

function placeholder(list: List, view: ReturnType<typeof deriveListView>): HTMLElement | null {
  const { ctx } = list;
  const s = ctx.store.get();
  if (view.rows.length > 0) return null;
  if (s.loading && s.papers.length === 0) return buildLoading();
  return buildEmptyState({
    narrowed: view.terms.length > 0 || s.status !== "all" || s.noText,
    onlyNoText: s.noText && view.terms.length === 0 && s.status === "all",
    onlyNested: view.inFolder.length > 0,
    folderLabel: folderLabel(PAPERS_DIR, s.folder, "/"),
    hint: ctx.labels.emptyHint,
    onClearFilters: () => { ctx.store.set({ status: "all", noText: false, query: "" }); ctx.focusSearch(); },
    onShowSubfolders: () => { ctx.prefs.save({ includeSub: true }); ctx.store.set({ includeSub: true }); },
    onAdd: () => requestAddPaper(ctx),
  });
}

function paintSelection(list: List): void {
  const { selected, cursor } = list.ctx.store.get();
  list.el.querySelectorAll<HTMLElement>(".paper-row").forEach((r) => {
    const id = r.dataset["id"] ?? "";
    r.classList.toggle("selected", selected.has(id));
    r.classList.toggle("cursor", id === cursor);
    r.setAttribute("aria-selected", String(selected.has(id)));
  });
}

function render(list: List): void {
  const s = list.ctx.store.get();
  const view = deriveListView(s);
  list.terms = view.terms;
  list.records = new Map(s.papers.map((p) => [p.id, p]));
  paintColumnHeads(list.heads, s.sortKey, s.sortDir);
  list.order = view.rows.map((p) => p.id);
  list.rows.update(view.rows, placeholder(list, view));
  const folderChanged = list.lastFolder !== s.folder;
  if (folderChanged) list.el.scrollTop = 0;
  list.lastFolder = s.folder;
  if (s.cursor && !list.order.includes(s.cursor)) {
    const alive = new Set(list.order);
    const selected = new Set([...s.selected].filter((id) => alive.has(id)));
    list.ctx.store.set({ selected, cursor: null, anchor: selected.size ? s.anchor : null });
  }
  paintSelection(list);
  const searchFocused = document.activeElement?.classList.contains("ls-library-search") ?? false;
  if (folderChanged && !searchFocused && !overlayOpen()) list.el.focus();
}

function cursorOf(list: List): ListCursor {
  return {
    order: () => list.order,
    step: (delta, extend) => {
      if (list.order.length === 0) return;
      const s = list.ctx.store.get();
      let idx = s.cursor ? list.order.indexOf(s.cursor) : -1;
      idx = idx === -1 ? (delta > 0 ? 0 : list.order.length - 1) : Math.min(list.order.length - 1, Math.max(0, idx + delta));
      const id = list.order[idx]!;
      if (extend && s.anchor) list.ctx.store.selectRange(list.order, id); else list.ctx.store.selectOnly(id);
      list.rows.nodeFor(id)?.scrollIntoView({ block: "nearest" });
    },
  };
}

/** Mounts the list and returns the function that unmounts it. */
export function mountPaperList(ctx: UiContext, container: HTMLElement): () => void {
  container.innerHTML = `${COLUMN_HEADS_HTML}<div class="paper-list" tabindex="0" role="listbox" aria-multiselectable="true"></div>`;
  const el = container.querySelector<HTMLElement>(".paper-list")!;
  // A row renders from its record, PDF presence, location, reading stats, OCR job and the highlighted terms; anything
  // else keeps the node.
  const list: List = {
    ctx, el, heads: container.querySelector<HTMLElement>(".col-heads")!, order: [], expanded: new Set(), lastFolder: null, terms: [], records: new Map(),
    rows: new RowReconciler<ListPaper>(el, (p) => buildPaperRow(p, rowView(list, p), handlers),
      (p) => [list.records.get(p.id), p.hasPdf, p.relFolder, list.terms.join("\u0000"), ctx.store.get().stats[p.id], ctx.store.get().jobs[p.id]]),
  };
  const handlers = rowHandlers(list);
  wireColumnHeads(ctx, list.heads);
  ctx.cursor = cursorOf(list);
  const offKeys = attachListKeys(ctx, ctx.cursor);
  const offRows = ctx.store.select(
    (s) => ({
      folder: s.folder, papers: s.papers, query: s.query, status: s.status, noText: s.noText, sortKey: s.sortKey, sortDir: s.sortDir,
      includeSub: s.includeSub, loading: s.loading, pdfDirs: s.pdfDirs, stats: s.stats, jobs: s.jobs,
    }),
    () => render(list),
  );
  const offSel = ctx.store.select((s) => ({ selected: s.selected, cursor: s.cursor }), () => paintSelection(list));
  return () => { offRows(); offSel(); offKeys(); };
}
