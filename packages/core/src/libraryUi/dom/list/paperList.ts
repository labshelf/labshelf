/**
 * Renders the paper list as a treegrid: column heads and one paper unit per paper in scope, grouped by subfolder and kept
 * in step by id so a refresh rebuilds only the rows that changed. Selection changes repaint attributes only, so scroll and focus survive.
 */
import { PAPERS_DIR, folderLabel } from "../../../library/index.js";
import { nextStatus, type PaperRecord } from "../../../model/index.js";
import { deriveListView, type ListPaper } from "../../viewModel/index.js";
import { COLUMN_KEYS, type ColumnKey } from "../../store/index.js";
import { endPaperDrag, startPaperDrag } from "../drag/index.js";
import { openPaper, requestAddPaper, setPaperStatus } from "../flows/index.js";
import { showPaperMenu } from "../menu/index.js";
import { overlayOpen, type UiContext } from "../uiContext.js";
import { columnHeadsHtml, wireColumnHeads } from "./columnHeads.js";
import { buildEmptyState, buildLoading } from "./emptyState.js";
import { GroupedRows } from "./groupedRows.js";
import { groupAriaLabel, groupPapers, type PaperGroup } from "./groupPapers.js";
import { attachListKeys } from "./listShortcuts.js";
import { paintTray, wireFilesRequest } from "./tray/index.js";
import { buildPaperRow, type RowHandlers, type RowView } from "./paperRow.js";
import { RowReconciler } from "./rowReconciler.js";
import { paintSortableHeads } from "./sortHeads.js";
import { paintTabStop, treeCursor, wireTabStop } from "./tree/index.js";
import { createWindowedList, type WindowedList } from "./window/index.js";

interface List {
  ctx: UiContext;
  el: HTMLElement;
  heads: HTMLElement;
  rows: GroupedRows<ListPaper, PaperGroup>;
  windowed: WindowedList;
  /** The empty or loading state rendered after the rows, if any. */
  trailing: HTMLElement | null;
  order: string[];
  lastFolder: string | null;
  /** What the rows of the current render are built from. */
  terms: string[];
  records: Map<string, PaperRecord>;
  /** The columns the heads and `--w-*` tracks are built for. */
  columns: readonly ColumnKey[];
}

function rowView(list: List, p: ListPaper): RowView {
  const s = list.ctx.store.get();
  return { terms: list.terms, stats: s.stats[p.id], job: s.jobs[p.id], textLayer: !!list.ctx.caps.textLayer, columns: s.columns };
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
    onTag: (tag) => ctx.store.searchTag(tag),
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
    narrowed: view.terms.length > 0,
    libraryEmpty: s.papers.length === 0,
    query: s.query,
    folderLabel: folderLabel(PAPERS_DIR, s.folder, "/"),
    hint: ctx.labels.emptyHint,
    onClearFilters: () => { ctx.store.set({ query: "" }); ctx.focusSearch(); },
    onAdd: ctx.readOnly ? null : () => requestAddPaper(ctx),
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

/** Rebuilds the heads when the shown columns change and collapses the tracks of hidden ones. */
function paintColumns(list: List): void {
  const { columns, sortKey, sortDir } = list.ctx.store.get();
  if (columns === list.columns) return;
  list.columns = columns;
  list.heads.innerHTML = columnHeadsHtml(columns);
  paintSortableHeads(list.heads, sortKey, sortDir === 1);
  for (const key of COLUMN_KEYS) {
    const track = `--w-${key === "lastRead" ? "read" : key}`;
    if (columns.includes(key)) list.el.style.removeProperty(track);
    else list.el.style.setProperty(track, "0px");
  }
}

/** Renders the windowed groups and repaints the attribute state on the rows they hold. */
function paintRows(list: List, groups: readonly PaperGroup[]): void {
  list.rows.update(groups, list.trailing);
  paintSelection(list); paintOpen(list); paintTray(list.ctx, list.el, list.records);
}

function render(list: List): void {
  const s = list.ctx.store.get();
  const view = deriveListView(s);
  list.terms = view.terms;
  list.records = new Map(s.papers.map((p) => [p.id, p]));
  paintColumns(list);
  paintSortableHeads(list.heads, s.sortKey, s.sortDir === 1);
  const groups = groupPapers(view.rows, s.folder);
  list.order = groups.flatMap((g) => g.papers.map((p) => p.id));
  list.trailing = placeholder(list, view);
  const folderChanged = list.lastFolder !== s.folder;
  if (folderChanged) list.el.scrollTop = 0;
  list.lastFolder = s.folder;
  list.windowed.update(groups, s.open);
  paintHeadsHeight(list);
  if (s.cursor && !list.order.includes(s.cursor)) {
    const alive = new Set(list.order);
    const selected = new Set([...s.selected].filter((id) => alive.has(id)));
    list.ctx.store.set({ selected, cursor: null, anchor: selected.size ? s.anchor : null });
  }
  const searchFocused = document.activeElement?.classList.contains("ls-library-search") ?? false;
  if (folderChanged && !searchFocused && !overlayOpen()) list.el.focus();
}

/** Mounts the list and returns the function that unmounts it. */
export function mountPaperList(ctx: UiContext, container: HTMLElement): () => void {
  // INVARIANT: the reconciler removes every child of its container it did not build, so each group body and the groups get their own.
  container.innerHTML = `<div class="paper-list" tabindex="-1" role="treegrid" aria-multiselectable="true">` +
    `<div class="col-heads" role="row"></div><div class="paper-rows" role="none"></div></div>`;
  const el = container.querySelector<HTMLElement>(".paper-list")!;
  const heads = container.querySelector<HTMLElement>(".col-heads")!;
  const body = el.querySelector<HTMLElement>(".paper-rows")!;
  // A row renders from its record, PDF presence, location, reading stats, OCR job and the highlighted terms; anything
  // else keeps the node.
  const list: List = {
    ctx, el, heads, order: [], lastFolder: null, terms: [], records: new Map(), columns: [], trailing: null,
    windowed: createWindowedList({ list: el, heads, body, paint: (groups) => paintRows(list, groups), cursor: () => ctx.store.get().cursor }),
    rows: new GroupedRows(body, (groupBody) => new RowReconciler<ListPaper>(groupBody, (p) => buildPaperRow(p, rowView(list, p), handlers),
      (p) => [list.records.get(p.id), p.hasPdf, p.relFolder, list.terms.join("\u0000"), ctx.store.get().columns, ctx.store.get().stats[p.id], ctx.store.get().jobs[p.id]]),
      { items: (g) => g.papers, ariaLabel: (g) => groupAriaLabel(g.segments, g.total) }),
  };
  const handlers = rowHandlers(list);
  wireColumnHeads(ctx, list.heads);
  el.addEventListener("click", (e) => {
    const folder = (e.target as HTMLElement).closest<HTMLElement>(".group-label [data-folder]")?.dataset["folder"];
    if (folder) ctx.store.openFolder(folder);
  });
  ctx.cursor = treeCursor(ctx.store, el, () => list.order, list.windowed);
  const offKeys = attachListKeys(ctx, ctx.cursor);
  const offTabStop = wireTabStop(el, () => ctx.store.get().cursor);
  const offRows = ctx.store.select(
    (s) => ({
      folder: s.folder, papers: s.papers, query: s.query, sortKey: s.sortKey, sortDir: s.sortDir, columns: s.columns,
      loading: s.loading, pdfDirs: s.pdfDirs, stats: s.stats, jobs: s.jobs, open: s.open, files: s.files,
    }),
    () => render(list),
  );
  const offFiles = wireFilesRequest(ctx);
  // ResizeObserver is absent where the list renders without layout (jsdom).
  const headsObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => paintHeadsHeight(list));
  headsObserver?.observe(list.heads);
  const offSel = ctx.store.select((s) => ({ selected: s.selected, cursor: s.cursor }), () => paintSelection(list));
  return () => { headsObserver?.disconnect(); list.windowed.dispose(); offRows(); offFiles(); offSel(); offKeys(); offTabStop(); };
}
