// Keyboard navigation of the paper treegrid: the rows the keyboard walks, the cursor walk, expansion keys and the roving tab stop.
import type { LibraryViewStore } from "../../store/index.js";
import type { ListCursor } from "../uiContext.js";
import type { WindowedList } from "./windowedList.js";

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

const CHILD_ROWS = ".paper-children [role=row]";

/** The rows on screen in order: each paper row, then its child rows when the paper is expanded. */
export function listVisibleRows(list: HTMLElement): HTMLElement[] {
  return [...list.querySelectorAll<HTMLElement>(`.paper-row-main, .paper-row.expanded ${CHILD_ROWS}`)];
}

/** Every paper row and child row, shown or not. */
function listAllRows(list: ParentNode): HTMLElement[] {
  return [...list.querySelectorAll<HTMLElement>(`.paper-row-main, ${CHILD_ROWS}`)];
}

/** The paper row of the paper with `id`, if it is rendered. */
export function findPaperRow(list: ParentNode, id: string | null): HTMLElement | null {
  if (id === null) return null;
  const unit = [...list.querySelectorAll<HTMLElement>(".paper-row")].find((r) => r.dataset["id"] === id);
  return unit?.querySelector<HTMLElement>(".paper-row-main") ?? null;
}

/** The id of the paper a row (paper or child) belongs to. */
export function readPaperId(row: HTMLElement): string {
  return row.closest<HTMLElement>(".paper-row")?.dataset["id"] ?? "";
}

/** The focused row inside `list`, if focus is on one. */
export function findFocusedRow(list: ParentNode): HTMLElement | null {
  const active = document.activeElement as HTMLElement | null;
  const row = active?.closest<HTMLElement>("[role=row]") ?? null;
  return row && list.contains(row) && !row.classList.contains("col-heads") ? row : null;
}

/** The focused child row inside `list`, if focus is on one. */
export function findFocusedChildRow(list: ParentNode): HTMLElement | null {
  const row = findFocusedRow(list);
  return row?.matches(CHILD_ROWS) ? row : null;
}

/** Child rows of the paper row `main`. */
function listChildRows(main: HTMLElement): HTMLElement[] {
  return [...(main.closest(".paper-row")?.querySelectorAll<HTMLElement>(CHILD_ROWS) ?? [])];
}

/** Focuses `row` and scrolls it into view. */
export function showRow(row: HTMLElement): void {
  row.focus({ preventScroll: true });
  row.scrollIntoView({ block: "nearest" });
}
