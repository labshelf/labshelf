// Renders, wires and paints sortable column heads; the stylesheet draws the sort indicator from aria-sort.
import { escapeHtml, renderIcon } from "../../../ui/index.js";

export interface SortableHeader {
  key: string;
  label: string;
  cls: string;
  title?: string;
  /** False renders a plain head with the same look and no sort affordance. */
  sortable: boolean;
}

export function renderSortableHeadHtml({ key, label, cls, title, sortable }: SortableHeader): string {
  const tip = title ? ` title="${escapeHtml(title)}"` : "";
  if (!sortable) return `<div class="col-head ${cls}" role="columnheader"${tip}>${escapeHtml(label)}</div>`;
  return `<div class="col-head sortable ${cls}" role="columnheader" aria-sort="none" data-sort="${escapeHtml(key)}"${tip}>` +
    `${escapeHtml(label)}<span class="sort-ind" aria-hidden="true">${renderIcon("chevron-down")}</span></div>`;
}

/** Calls `onSort` with the key of a clicked sortable head; returns the function that stops listening. */
export function attachSortableHeads(heads: HTMLElement, onSort: (key: string) => void): () => void {
  const onClick = (e: MouseEvent): void => {
    const key = (e.target as HTMLElement).closest<HTMLElement>(".sortable")?.dataset["sort"];
    if (key) onSort(key);
  };
  heads.addEventListener("click", onClick);
  return () => heads.removeEventListener("click", onClick);
}

export function drawSortableHeads(heads: HTMLElement, key: string, ascending: boolean): void {
  heads.querySelectorAll<HTMLElement>(".sortable").forEach((h) => {
    h.setAttribute("aria-sort", h.dataset["sort"] !== key ? "none" : ascending ? "ascending" : "descending");
  });
}
