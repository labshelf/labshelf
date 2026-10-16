/**
 * Renders the paper list as a treegrid: column heads and one paper unit per paper in scope, grouped by subfolder and kept
 * in step by id so a refresh rebuilds only the rows that changed. Selection changes repaint attributes only, so scroll and focus survive.
 */
import { PAPERS_DIR, folderLabel } from "../../../library/index.js";
import { STATUS_LABEL, nextStatus, type PaperRecord } from "../../../model/index.js";
import { deriveListView, type ListPaper } from "../../derive/index.js";
import { endPaperDrag, startPaperDrag } from "../dnd/index.js";
import { openPaper, requestAddPaper, setPaperStatus } from "../flows/index.js";
import { showPaperMenu } from "../menu/index.js";
import { overlayOpen, type UiContext } from "../uiContext.js";
import { COLUMN_HEADS_HTML, paintColumnHeads, wireColumnHeads } from "./columnHeads.js";
import { buildEmptyState, buildLoading } from "./emptyState.js";
import { GroupedRows, groupPapers } from "./groups/index.js";
import { attachListKeys } from "./listKeys.js";
import { paintTray, wireFilesRequest } from "./tray/index.js";
import { buildPaperRow, type RowHandlers, type RowView } from "./paperRow.js";
import { RowReconciler } from "./rowReconciler.js";
import { paintTabStop, treeCursor, wireTabStop } from "./treeNav/index.js";

interface List {
  ctx: UiContext;
  el: HTMLElement;
  heads: HTMLElement;
  rows: GroupedRows;
  order: string[];
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
    isOpen: (id) => ctx.store.get().open === id,
    onToggle: (id) => ctx.store.openPaper(ctx.store.get().open === id ? null : id),
  };
}

function placeholder(list: List, view: ReturnType<typeof deriveListView>): HTMLElement | null {
  const { ctx } = list;
  const s = ctx.store.get();
  if (view.rows.length > 0) return null;
  if (s.loading && s.papers.length === 0) return buildLoading();
  return buildEmptyState({
    narrowed: view.terms.length > 0 || s.status !== "all",
    libraryEmpty: s.papers.length === 0,
    query: s.query,
    folderLabel: folderLabel(PAPERS_DIR, s.folder, "/"),
    statusLabel: s.status === "all" ? null : STATUS_LABEL[s.status],
    hint: ctx.labels.emptyHint,
    onClearFilters: () => { ctx.store.set({ status: "all", query: "" }); ctx.focusSearch(); },
    onAdd: () => requestAddPaper(ctx),
  });
}

function paintSelection(list: List): void {
  const { selected, cursor } = list.ctx.store.get();
  list.el.querySelectorAll<HTMLElement>(".paper-row").forEach((r) => {
    const id = r.dataset["id"] ?? "";
    r.classList.toggle("selected", selected.has(id));
    r.classList.toggle("cursor", id === cursor);
    r.querySelector(".paper-row-main")?.setAttribute("aria-selected", String(selected.has(id)));
  });
  paintTabStop(list.el, cursor);
}

/** Marks the open paper's unit expanded and every other collapsed, without rebuilding rows, so focus and scroll stay. */
function paintOpen(list: List): void {
  const { open } = list.ctx.store.get();
  list.el.querySelectorAll<HTMLElement>(".paper-row").forEach((r) => {
    const isOpen = r.dataset["id"] === open;
    r.classList.toggle("expanded", isOpen);
    r.querySelector(".expand-btn")?.classList.toggle("collapsed", !isOpen);
    r.querySelector(".paper-row-main")?.setAttribute("aria-expanded", String(isOpen));
  });
}

/** Sticky group labels sit below the column heads, whose height changes with the font and the sort indicator. */
function paintHeadsHeight(list: List): void {
  list.el.style.setProperty("--heads-h", `${list.heads.offsetHeight}px`);
}

function render(list: List): void {
  const s = list.ctx.store.get();
  const view = deriveListView(s);
  list.terms = view.terms;
  list.records = new Map(s.papers.map((p) => [p.id, p]));
  paintColumnHeads(list.heads, s.sortKey, s.sortDir);
  const groups = groupPapers(view.rows, s.folder);
  list.order = groups.flatMap((g) => g.papers.map((p) => p.id));
  list.rows.update(groups, placeholder(list, view));
  paintHeadsHeight(list);
  const folderChanged = list.lastFolder !== s.folder;
  if (folderChanged) list.el.scrollTop = 0;
  list.lastFolder = s.folder;
  if (s.cursor && !list.order.includes(s.cursor)) {
    const alive = new Set(list.order);
    const selected = new Set([...s.selected].filter((id) => alive.has(id)));
    list.ctx.store.set({ selected, cursor: null, anchor: selected.size ? s.anchor : null });
  }
  paintSelection(list);
  paintOpen(list);
  paintTray(list.ctx, list.el, list.records);
  const searchFocused = document.activeElement?.classList.contains("ls-library-search") ?? false;
  if (folderChanged && !searchFocused && !overlayOpen()) list.el.focus();
}

/** Mounts the list and returns the function that unmounts it. */
export function mountPaperList(ctx: UiContext, container: HTMLElement): () => void {
  // INVARIANT: the reconciler removes every child of its container it did not build, so each group body and the groups get their own.
  container.innerHTML = `<div class="paper-list" tabindex="-1" role="treegrid" aria-multiselectable="true">${COLUMN_HEADS_HTML}` +
    `<div class="paper-rows" role="none"></div></div>`;
  const el = container.querySelector<HTMLElement>(".paper-list")!;
  // A row renders from its record, PDF presence, location, reading stats, OCR job and the highlighted terms; anything
  // else keeps the node.
  const list: List = {
    ctx, el, heads: container.querySelector<HTMLElement>(".col-heads")!, order: [], lastFolder: null, terms: [], records: new Map(),
    rows: new GroupedRows(el.querySelector<HTMLElement>(".paper-rows")!, (body) => new RowReconciler<ListPaper>(body, (p) => buildPaperRow(p, rowView(list, p), handlers),
      (p) => [list.records.get(p.id), p.hasPdf, p.relFolder, list.terms.join("\u0000"), ctx.store.get().stats[p.id], ctx.store.get().jobs[p.id]])),
  };
  const handlers = rowHandlers(list);
  wireColumnHeads(ctx, list.heads);
  ctx.cursor = treeCursor(ctx.store, el, () => list.order);
  const offKeys = attachListKeys(ctx, ctx.cursor);
  const offTabStop = wireTabStop(el, () => ctx.store.get().cursor);
  const offRows = ctx.store.select(
    (s) => ({
      folder: s.folder, papers: s.papers, query: s.query, status: s.status, sortKey: s.sortKey, sortDir: s.sortDir,
      loading: s.loading, pdfDirs: s.pdfDirs, stats: s.stats, jobs: s.jobs, open: s.open, files: s.files,
    }),
    () => render(list),
  );
  const offFiles = wireFilesRequest(ctx);
  // ResizeObserver is absent where the list renders without layout (jsdom).
  const headsObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => paintHeadsHeight(list));
  headsObserver?.observe(list.heads);
  const offSel = ctx.store.select((s) => ({ selected: s.selected, cursor: s.cursor }), () => paintSelection(list));
  return () => { headsObserver?.disconnect(); offRows(); offFiles(); offSel(); offKeys(); offTabStop(); };
}
