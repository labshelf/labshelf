// Moves the list cursor over the paper rows, walking the rendered treegrid rows and the whole list when the target is not rendered.
import type { LibraryViewStore } from "../../../store/index.js";
import type { ListCursor } from "../../uiContext.js";
import type { WindowedList } from "../window/index.js";
import { showRow, findFocusedRow, readPaperId, findPaperRow, listVisibleRows } from "./treeRows.js";

type Windowed = Pick<WindowedList, "reveal" | "pageSize">;

function edgeRow(rows: HTMLElement[], delta: number): HTMLElement | undefined {
  const papers = rows.filter((r) => r.classList.contains("paper-row-main"));
  return delta > 0 ? papers[0] : papers[papers.length - 1];
}

/**
 * Builds the cursor of the list `list`: a step lands on the visible row `delta` rows away, or on the paper `delta`
 * places away in `order` when that row is not rendered, selects the paper and focuses it. With no cursor, a step
 * starts from the first or last rendered paper row.
 */
export function createTreeCursor(store: LibraryViewStore, list: HTMLElement, order: () => readonly string[], windowed: Windowed): ListCursor {
  /** Selects the paper `id` and focuses `target` (default its paper row), rendering the paper first when it is outside the window. */
  function land(id: string, extend: boolean, target?: HTMLElement): void {
    let row = target ?? findPaperRow(list, id);
    if (!row) {
      windowed.reveal(order().indexOf(id));
      row = findPaperRow(list, id);
    }
    if (extend && store.get().anchor) store.selectRange(order(), id); else store.selectOnly(id);
    if (row) showRow(row);
  }

  function move(delta: number, extend: boolean): void {
    const rows = listVisibleRows(list);
    const s = store.get();
    const focused = findFocusedRow(list);
    const at = focused && s.cursor !== null && readPaperId(focused) === s.cursor ? focused : findPaperRow(list, s.cursor);
    const idx = at ? rows.indexOf(at) : -1;
    const dom = rows[idx + delta];
    if (idx !== -1 && dom) return land(readPaperId(dom), extend, dom);
    const ids = order();
    const from = s.cursor === null ? -1 : ids.indexOf(s.cursor);
    if (from === -1) {
      const edge = edgeRow(rows, delta);
      if (edge) land(readPaperId(edge), extend, edge);
      return;
    }
    const to = ids[Math.min(ids.length - 1, Math.max(0, from + delta))];
    if (to !== undefined && to !== s.cursor) land(to, extend);
  }

  return {
    order,
    step: move,
    page: (dir, extend) => move(dir * (windowed.pageSize() || Math.max(1, listVisibleRows(list).length - 1)), extend),
    edge: (to) => {
      const ids = order();
      const id = to === "first" ? ids[0] : ids[ids.length - 1];
      if (id !== undefined) land(id, false);
    },
  };
}
