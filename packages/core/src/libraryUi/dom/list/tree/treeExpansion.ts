// Expands and collapses paper rows from the keyboard and moves focus between a paper row and its child rows.
import { listChildRows, showRow, findFocusedChildRow, findPaperRow } from "./treeRows.js";

// The twistie's click handler toggles the store's open paper, so the keyboard goes through it.
function toggle(main: HTMLElement): void {
  main.querySelector<HTMLElement>(".expand-btn")?.click();
}

/** Expands the cursor's paper row, or focuses its first child row when it is expanded; false when nothing happened. */
export function openOrEnter(root: ParentNode, cursor: string | null): boolean {
  if (findFocusedChildRow(root)) return false;
  const main = findPaperRow(root, cursor);
  const state = main?.getAttribute("aria-expanded");
  if (!main || !state) return false;
  if (state === "false") { toggle(main); return true; }
  const first = listChildRows(main)[0];
  if (first) showRow(first);
  return !!first;
}

/** Leaves a focused child row for its paper row, or collapses the cursor's expanded paper row; false when nothing happened. */
export function closeOrLeave(root: ParentNode, cursor: string | null): boolean {
  const child = findFocusedChildRow(root);
  const parent = child?.closest(".paper-row")?.querySelector<HTMLElement>(".paper-row-main");
  if (parent) { showRow(parent); return true; }
  const main = findPaperRow(root, cursor);
  if (main?.getAttribute("aria-expanded") !== "true") return false;
  toggle(main);
  return true;
}
