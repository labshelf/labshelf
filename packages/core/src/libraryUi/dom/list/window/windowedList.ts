// Renders only the paper rows near the viewport, re-slicing on scroll and resize, with padding standing in for the rest.
import type { PaperGroup } from "../groupPapers.js";
import { readRowHeight } from "./rowHeight.js";
import { createRowWindow, type RowViewport } from "./rowWindow.js";
import { findFocusedRow, findPaperRow } from "../tree/index.js";

/** The open paper's tray: its rendered height in px and its row count. */
interface OpenExtent {
  id: string | null;
  height: number;
  rows: number;
}

const NO_EXTENT: OpenExtent = { id: null, height: 0, rows: 0 };

/**
 * Maps a physical scroll offset to the offset in a list of fixed-height rows without the tray: offsets inside the tray
 * collapse onto the row after the open one. `openRow` is -1 when no paper is open.
 */
function toLogical(scrollTop: number, openRow: number, rowHeight: number, extra: number): number {
  if (openRow < 0) return scrollTop;
  const openEnd = (openRow + 1) * rowHeight;
  if (scrollTop <= openEnd) return scrollTop;
  return scrollTop <= openEnd + extra ? openEnd : scrollTop - extra;
}

/** The rendered tray of paper `id`, or null when its row is not rendered (the last measurement then still holds). */
function measureOpenExtent(list: HTMLElement, id: string | null): OpenExtent | null {
  if (!id) return NO_EXTENT;
  const tray = findPaperRow(list, id)?.closest(".paper-row")?.querySelector<HTMLElement>(".paper-children");
  if (!tray) return null;
  return { id, height: tray.offsetHeight, rows: tray.querySelectorAll('[role="row"]').length };
}

/** Where one paper sits in the flat rows, and whether a sticky group label covers the top of the viewport above it. */
interface PaperPlace {
  row: number;
  labelled: boolean;
}

interface ListModel {
  groups: readonly PaperGroup[];
  /** Flat row count, labels included. */
  rows: number;
  /** The flat row of each group's first row (its label, or its first paper when unlabelled). */
  starts: number[];
  /** One entry per paper, in list order. */
  papers: PaperPlace[];
  /** The list index of each paper id. */
  indexOf: Map<string, number>;
}

/** The groups that the flat rows `start` to `end` show; `stickyLabel` is set when the first group's label sits above `start`. */
interface GroupWindow {
  groups: PaperGroup[];
  stickyLabel: boolean;
}

const labelRows = (g: PaperGroup): number => (g.segments.length > 0 ? 1 : 0);

function buildListModel(groups: readonly PaperGroup[]): ListModel {
  const starts: number[] = [];
  const papers: PaperPlace[] = [];
  const indexOf = new Map<string, number>();
  let row = 0;
  for (const g of groups) {
    starts.push(row);
    row += labelRows(g);
    for (const p of g.papers) {
      indexOf.set(p.id, papers.length);
      papers.push({ row: row++, labelled: labelRows(g) > 0 });
    }
  }
  return { groups, rows: row, starts, papers, indexOf };
}

/** Copies of the groups cut to the flat rows `start` (inclusive) to `end` (exclusive); each keeps its full `total`. */
function windowGroups(model: ListModel, start: number, end: number): GroupWindow {
  const out: PaperGroup[] = [];
  let stickyLabel = false;
  model.groups.forEach((g, i) => {
    const first = model.starts[i]! + labelRows(g);
    const last = first + g.papers.length;
    if (last <= start || model.starts[i]! >= end) return;
    // A slice that starts inside a labelled group still renders the label, so the sticky label stays over its papers.
    if (out.length === 0 && labelRows(g) > 0 && start > model.starts[i]!) stickyLabel = true;
    out.push({ ...g, papers: g.papers.slice(Math.max(0, start - first), Math.max(0, end - first)) });
  });
  return { groups: out, stickyLabel };
}

const PARKED = "data-parked";

/**
 * Call before the rows are repainted; the returned function, called after, parks focus on the grid element when the
 * focused row was removed (the browser would move it to `body`) and restores it to the cursor row once that renders.
 */
function parkFocus(list: HTMLElement, cursor: () => string | null): () => void {
  const hadRow = findFocusedRow(list) !== null;
  return () => {
    const active = document.activeElement;
    if (hadRow && !list.contains(active) && (active === document.body || active === null)) {
      list.setAttribute(PARKED, "");
      list.addEventListener("blur", () => list.removeAttribute(PARKED), { once: true });
      list.focus({ preventScroll: true });
      return;
    }
    if (active !== list || !list.hasAttribute(PARKED)) return;
    const row = findPaperRow(list, cursor());
    if (!row) return;
    list.removeAttribute(PARKED);
    row.focus({ preventScroll: true });
  };
}

/**
 * Sets `aria-rowcount` on the grid (the column heads, every paper and the open paper's tray rows) and `aria-rowindex`
 * on the heads and every rendered paper and tray row. Call after the rows and the tray are painted.
 */
function paintAriaRows(list: HTMLElement, heads: HTMLElement, indexOf: ReadonlyMap<string, number>, open: OpenExtent): void {
  const openIdx = open.id === null ? -1 : (indexOf.get(open.id) ?? -1);
  const trayRows = openIdx < 0 ? 0 : open.rows;
  list.setAttribute("aria-rowcount", String(1 + indexOf.size + trayRows));
  heads.setAttribute("aria-rowindex", "1");
  list.querySelectorAll<HTMLElement>(".paper-row").forEach((unit) => {
    const idx = indexOf.get(unit.dataset["id"] ?? "");
    if (idx === undefined) return;
    const rowIndex = 2 + idx + (openIdx >= 0 && openIdx < idx ? trayRows : 0);
    unit.querySelector(".paper-row-main")?.setAttribute("aria-rowindex", String(rowIndex));
    if (idx !== openIdx) return;
    unit.querySelectorAll('.paper-children [role="row"]').forEach((r, j) => r.setAttribute("aria-rowindex", String(rowIndex + 1 + j)));
  });
}

export interface WindowedListParts {
  /** The scrolling treegrid. */
  list: HTMLElement;
  /** The sticky column heads, which cover the top of the viewport. */
  heads: HTMLElement;
  /** The rows container; its top and bottom padding stand in for the rows outside the window. */
  body: HTMLElement;
  /** Renders the given (windowed) groups and paints selection, open state and tray on them. */
  paint: (groups: readonly PaperGroup[]) => void;
  /** The id of the cursor paper, whose row keeps keyboard focus when it scrolls out and back. */
  cursor: () => string | null;
}

export interface WindowedList {
  /** Renders `groups` with paper `open` expanded, cut to the viewport. */
  update(groups: readonly PaperGroup[], open: string | null): void;
  /** Scrolls the paper at list index `paperIndex` into view and renders it. */
  reveal(paperIndex: number): void;
  /** Rows a PageUp or PageDown moves: the viewport rows minus one; 0 without layout. */
  pageSize(): number;
  dispose(): void;
}

interface Slice {
  groups: readonly PaperGroup[];
  padTop: number;
  padBottom: number;
}

/**
 * The scroll offset that shows the paper at `place`, below the sticky label of its group; `shift` is the open tray's
 * height when the tray sits above the paper.
 */
function revealedTop(place: PaperPlace, view: RowViewport, rowH: number, shift: number): number {
  const cover = place.labelled ? rowH : 0;
  const logical = { scrollTop: view.scrollTop + cover - shift, height: view.height - cover };
  return createRowWindow({ rowHeight: rowH }).scrollTopFor(place.row, logical) + shift - cover;
}

interface State {
  model: ListModel;
  open: OpenExtent;
  rowH: number;
  painted: string;
}

const viewHeight = ({ list, heads }: WindowedListParts): number => list.clientHeight - heads.offsetHeight;
const openRow = (st: State): number => (st.open.id === null ? -1 : (st.model.papers[st.model.indexOf.get(st.open.id) ?? -1]?.row ?? -1));

/** The groups to render for the current scroll position, and the padding for the rows left out. */
function sliceOf(parts: WindowedListParts, st: State): Slice {
  const height = viewHeight(parts);
  const all: Slice = { groups: st.model.groups, padTop: 0, padBottom: 0 };
  // Without layout (jsdom, a hidden pane) every row renders.
  if (height <= 0) return all;
  if (!st.rowH) st.rowH = readRowHeight(parts.list);
  if (!(st.rowH > 0)) return all;
  const { rowH, open } = st;
  const at = openRow(st);
  const logical = { scrollTop: toLogical(parts.list.scrollTop, at, rowH, open.height), height };
  const s = createRowWindow({ rowHeight: rowH }).slice(st.model.rows, logical);
  const w = windowGroups(st.model, s.start, s.end);
  const padTop = s.padTop + (at >= 0 && at < s.start ? open.height : 0) - (w.stickyLabel ? rowH : 0);
  return { groups: w.groups, padTop, padBottom: s.padBottom + (at >= s.end ? open.height : 0) };
}

/** Renders the slice when it differs from the painted one (or `force`), keeping keyboard focus with the cursor row. */
function paintSlice(parts: WindowedListParts, st: State, force: boolean): void {
  const s = sliceOf(parts, st);
  const key = `${s.padTop}:${s.padBottom}:${s.groups.map((g) => `${g.key}/${g.papers.length}/${g.papers[0]?.id}`).join("|")}`;
  if (!force && key === st.painted) return;
  st.painted = key;
  parts.body.style.paddingTop = s.padTop ? `${s.padTop}px` : "";
  parts.body.style.paddingBottom = s.padBottom ? `${s.padBottom}px` : "";
  const focus = parkFocus(parts.list, parts.cursor);
  parts.paint(s.groups);
  focus();
  const measured = measureOpenExtent(parts.list, st.open.id);
  const changed = measured !== null && (measured.height !== st.open.height || measured.rows !== st.open.rows);
  if (measured) st.open = measured;
  // A tray that grew or shrank moves every row below it; slice again so the padding matches.
  if (changed && st.rowH > 0) paintSlice(parts, st, false);
  paintAriaRows(parts.list, parts.heads, st.model.indexOf, st.open);
}

export function createWindowedList(parts: WindowedListParts): WindowedList {
  const { list } = parts;
  const st: State = { model: buildListModel([]), open: NO_EXTENT, rowH: 0, painted: "" };
  let frame = 0;
  const onScroll = (): void => {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; paintSlice(parts, st, false); });
  };
  list.addEventListener("scroll", onScroll, { passive: true });
  // ResizeObserver is absent where the list renders without layout (jsdom).
  const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => { st.rowH = 0; paintSlice(parts, st, false); });
  resize?.observe(list);

  return {
    update(groups, openId) {
      st.model = buildListModel(groups);
      if (st.open.id !== openId) st.open = { id: openId, height: 0, rows: 0 };
      paintSlice(parts, st, true);
    },
    reveal(paperIndex) {
      const place = st.model.papers[paperIndex];
      const height = viewHeight(parts);
      if (!place || !(st.rowH > 0) || height <= 0) return;
      const at = openRow(st);
      list.scrollTop = revealedTop(place, { scrollTop: list.scrollTop, height }, st.rowH, at >= 0 && at < place.row ? st.open.height : 0);
      paintSlice(parts, st, false);
    },
    pageSize: () => (st.rowH > 0 ? Math.max(1, Math.floor(viewHeight(parts) / st.rowH) - 1) : 0),
    dispose() {
      list.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
      resize?.disconnect();
    },
  };
}
