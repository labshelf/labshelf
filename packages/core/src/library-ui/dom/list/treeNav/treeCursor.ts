// Moves the list cursor over the visible treegrid rows, so the arrow keys walk into and out of a paper's child rows.
import type { LibraryViewStore } from "../../../state/index.js";
import type { ListCursor } from "../../uiContext.js";
import { focusRow, focusedRow, paperIdOf, paperRowOf, visibleRows } from "./treeRows.js";

function edgeRow(rows: HTMLElement[], delta: 1 | -1): HTMLElement | undefined {
  const papers = rows.filter((r) => r.classList.contains("paper-row-main"));
  return delta > 0 ? papers[0] : papers[papers.length - 1];
}

/**
 * Builds the cursor of the list `list`: a step lands on the next visible row, selects the paper it belongs to and
 * focuses it. With no cursor, a step starts from the first or last paper row.
 */
export function treeCursor(store: LibraryViewStore, list: HTMLElement, order: () => readonly string[]): ListCursor {
  return {
    order,
    step: (delta, extend) => {
      const rows = visibleRows(list);
      const s = store.get();
      const focused = focusedRow(list);
      const at = focused && s.cursor !== null && paperIdOf(focused) === s.cursor ? focused : paperRowOf(list, s.cursor);
      const idx = at ? rows.indexOf(at) : -1;
      const target = idx === -1 ? edgeRow(rows, delta) : rows[Math.min(rows.length - 1, Math.max(0, idx + delta))];
      if (!target) return;
      const id = paperIdOf(target);
      if (extend && s.anchor) store.selectRange(order(), id); else store.selectOnly(id);
      focusRow(target);
    },
  };
}
