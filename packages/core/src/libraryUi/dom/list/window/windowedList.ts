// Renders only the paper rows near the viewport, re-slicing on scroll and resize, with padding standing in for the rest.
import type { PaperGroup } from "../groupPapers.js";
import { measureRowHeight } from "./rowHeight.js";
import { createRowWindow, type RowViewport } from "./rowWindow.js";
import { paintAriaRows } from "./ariaRows.js";
import { parkFocus } from "./focusPark.js";
import { buildListModel, windowGroups, type ListModel, type PaperPlace } from "./listModel.js";
import { measureOpenExtent, NO_EXTENT, toLogical, type OpenExtent } from "./openExtent.js";

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
  if (!st.rowH) st.rowH = measureRowHeight(parts.list);
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
