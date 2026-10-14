/**
 * The sortable column heads above the list. A click on the sorted column flips its direction; a click on another
 * column sorts by it in that column's first direction (dates newest first).
 */
import { icon } from "../../../ui/index.js";
import { firstSortDir } from "../../derive/index.js";
import type { SortDir, SortKey } from "../../state/index.js";
import type { UiContext } from "../uiContext.js";

const COLUMNS: Array<{ key: SortKey; label: string; cls?: string }> = [
  { key: "title", label: "Title" }, { key: "creator", label: "Creator" }, { key: "year", label: "Year" },
  { key: "publication", label: "Publication", cls: "col-pub" }, { key: "status", label: "Status" },
];

export const COLUMN_HEADS_HTML = `<div class="col-heads"><div></div><div></div>${COLUMNS.map((c) =>
  `<div class="col-head sortable ${c.cls ?? ""}" data-sort="${c.key}">${c.label}<span class="sort-ind">${icon("chevron-down")}</span></div>`).join("")}</div>`;

/** Wires the head clicks: they change the sort and save it. */
export function wireColumnHeads(ctx: UiContext, heads: HTMLElement): void {
  heads.querySelectorAll<HTMLElement>(".sortable").forEach((h) => h.addEventListener("click", () => {
    const key = h.dataset["sort"] as SortKey;
    const s = ctx.store.get();
    const patch = s.sortKey === key ? { sortDir: (-s.sortDir) as SortDir } : { sortKey: key, sortDir: firstSortDir(key) };
    ctx.prefs.save(patch);
    ctx.store.set(patch);
  }));
}

/** Marks the sorted column and its direction. */
export function paintColumnHeads(heads: HTMLElement, key: SortKey, dir: SortDir): void {
  heads.querySelectorAll<HTMLElement>(".sortable").forEach((h) => {
    const on = h.dataset["sort"] === key;
    h.classList.toggle("sorted", on);
    h.classList.toggle("asc", on && dir === 1);
  });
}
