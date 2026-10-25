// Finds the treegrid rows the keyboard walks: paper rows, and the child rows of expanded papers.
// Child rows are any `[role=row]` inside a paper's `.paper-children`, so new kinds of child row need no change here.

const CHILD_ROWS = ".paper-children [role=row]";

/** The rows on screen in order: each paper row, then its child rows when the paper is expanded. */
export function visibleRows(list: HTMLElement): HTMLElement[] {
  return [...list.querySelectorAll<HTMLElement>(`.paper-row-main, .paper-row.expanded ${CHILD_ROWS}`)];
}

/** Every paper row and child row, shown or not. */
export function allRows(list: ParentNode): HTMLElement[] {
  return [...list.querySelectorAll<HTMLElement>(`.paper-row-main, ${CHILD_ROWS}`)];
}

/** The paper row of the paper with `id`, if it is rendered. */
export function paperRowOf(list: ParentNode, id: string | null): HTMLElement | null {
  if (id === null) return null;
  const unit = [...list.querySelectorAll<HTMLElement>(".paper-row")].find((r) => r.dataset["id"] === id);
  return unit?.querySelector<HTMLElement>(".paper-row-main") ?? null;
}

/** The id of the paper a row (paper or child) belongs to. */
export function paperIdOf(row: HTMLElement): string {
  return row.closest<HTMLElement>(".paper-row")?.dataset["id"] ?? "";
}

/** The focused row inside `list`, if focus is on one. */
export function focusedRow(list: ParentNode): HTMLElement | null {
  const active = document.activeElement as HTMLElement | null;
  const row = active?.closest<HTMLElement>("[role=row]") ?? null;
  return row && list.contains(row) && !row.classList.contains("col-heads") ? row : null;
}

/** The focused child row inside `list`, if focus is on one. */
export function focusedChildRow(list: ParentNode): HTMLElement | null {
  const row = focusedRow(list);
  return row?.matches(CHILD_ROWS) ? row : null;
}

/** Child rows of the paper row `main`. */
export function childRowsOf(main: HTMLElement): HTMLElement[] {
  return [...(main.closest(".paper-row")?.querySelectorAll<HTMLElement>(CHILD_ROWS) ?? [])];
}

/** Focuses `row` and scrolls it into view. */
export function focusRow(row: HTMLElement): void {
  row.focus({ preventScroll: true });
  row.scrollIntoView({ block: "nearest" });
}
