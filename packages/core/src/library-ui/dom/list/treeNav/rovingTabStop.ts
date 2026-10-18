// Keeps exactly one treegrid row in the tab order (roving tabindex) and hands focus on the grid itself to that row.
import { allRows, focusedRow, paperRowOf } from "./treeRows.js";

/** Gives tabindex 0 to the focused row, else the cursor's paper row, else the first row; every other row gets -1. */
export function paintTabStop(list: HTMLElement, cursor: string | null): void {
  const rows = allRows(list);
  const stop = focusedRow(list) ?? paperRowOf(list, cursor) ?? rows[0];
  for (const r of rows) r.tabIndex = r === stop ? 0 : -1;
}

/** Repaints the tab stop as focus moves between rows; returns the function that stops it. */
export function wireTabStop(list: HTMLElement, cursor: () => string | null): () => void {
  const onFocusIn = (): void => paintTabStop(list, cursor());
  // The host focuses the grid element (focusList, a folder change); the tab-stop row takes it over, unless focus is
  // parked there because its row scrolled out of the window.
  const onFocus = (e: FocusEvent): void => {
    if (e.target === list && !list.hasAttribute("data-parked")) list.querySelector<HTMLElement>('[role="row"][tabindex="0"]')?.focus({ preventScroll: true });
  };
  list.addEventListener("focusin", onFocusIn);
  list.addEventListener("focus", onFocus);
  return () => { list.removeEventListener("focusin", onFocusIn); list.removeEventListener("focus", onFocus); };
}
