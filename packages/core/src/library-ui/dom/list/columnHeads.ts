/**
 * Renders the sortable column heads above the list. A click on the sorted column flips its direction; a click on another
 * column sorts by it in that column's first direction (dates newest first).
 */
import { icon } from "../../../ui/index.js";
import { firstSortDir } from "../../derive/index.js";
import type { SortDir, SortKey } from "../../state/index.js";
import type { UiContext } from "../uiContext.js";

const COLUMNS: Array<{ key: SortKey; label: string; cls?: string; title?: string }> = [
  { key: "title", label: "Title" }, { key: "creator", label: "Authors", cls: "col-creator" }, { key: "year", label: "Year", cls: "col-year" },
  { key: "lastRead", label: "Last read", cls: "col-read", title: "When you last had the paper open in the reader" },
  { key: "status", label: "Status" },
];

// The two blank cells sit over the twistie and type icon columns.
export const COLUMN_HEADS_HTML = `<div class="col-heads" role="row"><div aria-hidden="true"></div>${COLUMNS.map((c) =>
  `<div class="col-head sortable ${c.cls ?? ""}" role="columnheader" aria-sort="none" data-sort="${c.key}"${c.title ? ` title="${c.title}"` : ""}>` +
  `${c.label}<span class="sort-ind" aria-hidden="true">${icon("chevron-down")}</span></div>`).join("")}</div>`;

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

/** Marks the sorted column and its direction; the stylesheet draws the indicator from aria-sort. */
export function paintColumnHeads(heads: HTMLElement, key: SortKey, dir: SortDir): void {
  heads.querySelectorAll<HTMLElement>(".sortable").forEach((h) => {
    h.setAttribute("aria-sort", h.dataset["sort"] !== key ? "none" : dir === 1 ? "ascending" : "descending");
  });
}
