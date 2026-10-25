// Keeps exactly one treegrid row in the tab order (roving tabindex) and hands focus on the grid itself to that row.
import { listAllRows, findFocusedRow, findPaperRow } from "./treeRows.js";

/** Gives tabindex 0 to the focused row, else the cursor's paper row, else the first row; every other row gets -1. */
export function drawTabStop(list: HTMLElement, cursor: string | null): void {
  const rows = listAllRows(list);
  const stop = findFocusedRow(list) ?? findPaperRow(list, cursor) ?? rows[0];
  for (const r of rows) r.tabIndex = r === stop ? 0 : -1;
}

/** Repaints the tab stop as focus moves between rows; returns the function that stops it. */
export function attachTabStop(list: HTMLElement, cursor: () => string | null): () => void {
  const onFocusIn = (): void => drawTabStop(list, cursor());
  // The host focuses the grid element (focusList, a folder change); the tab-stop row takes it over, unless focus is
  // parked there because its row scrolled out of the window.
  const onFocus = (e: FocusEvent): void => {
    if (e.target === list && !list.hasAttribute("data-parked")) list.querySelector<HTMLElement>('[role="row"][tabindex="0"]')?.focus({ preventScroll: true });
  };
  list.addEventListener("focusin", onFocusIn);
  list.addEventListener("focus", onFocus);
  return () => { list.removeEventListener("focusin", onFocusIn); list.removeEventListener("focus", onFocus); };
}
