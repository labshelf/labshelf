/**
 * Renders the paper list's column heads from its column config. A click on the sorted column flips its direction; a click on another
 * column sorts by it in that column's first direction (dates newest first). The Columns button and a right-click open the columns menu.
 */
import { icon } from "../../../ui/index.js";
import { firstSortDir } from "../../derive/index.js";
import { COLUMN_KEYS, type ColumnKey, type SortDir, type SortKey } from "../../state/index.js";
import { showColumnsMenu } from "../menu/index.js";
import type { UiContext } from "../uiContext.js";
import { sortableHeadHtml, wireSortableHeads } from "./sortableHeads.js";

const OPTIONAL: Record<ColumnKey, { label: string; cls: string; title?: string }> = {
  creator: { label: "Authors", cls: "col-creator" },
  venue: { label: "Venue", cls: "col-venue" },
  year: { label: "Year", cls: "col-year" },
  lastRead: { label: "Last read", cls: "col-read", title: "When you last had the paper open in the reader" },
  status: { label: "Status", cls: "col-status" },
};

const headHtml = (key: SortKey, label: string, cls: string, title?: string): string =>
  sortableHeadHtml({ key, label, cls, ...(title ? { title } : {}), sortable: true });

/** The cells of the head row: a blank cell over the twistie, Title, the shown columns in fixed order, and the Columns button. */
export function columnHeadsHtml(columns: readonly ColumnKey[]): string {
  const shown = COLUMN_KEYS.filter((k) => columns.includes(k)).map((k) => headHtml(k, OPTIONAL[k].label, OPTIONAL[k].cls, OPTIONAL[k].title));
  return `<div aria-hidden="true"></div>${headHtml("title", "Title", "")}${shown.join("")}` +
    `<div class="col-menu"><button class="ls-icon-btn" type="button" title="Columns" aria-label="Columns">${icon("more")}</button></div>`;
}

/** Wires the head clicks once: they change the sort and save it, and the Columns button and a right-click open the columns menu. */
export function wireColumnHeads(ctx: UiContext, heads: HTMLElement): void {
  heads.addEventListener("click", (e) => {
    const button = (e.target as HTMLElement).closest<HTMLElement>(".col-menu button");
    if (button) showColumnsMenu(ctx, button);
  });
  wireSortableHeads(heads, (sortKey) => {
    const key = sortKey as SortKey;
    const s = ctx.store.get();
    const patch = s.sortKey === key ? { sortDir: (-s.sortDir) as SortDir } : { sortKey: key, sortDir: firstSortDir(key) };
    ctx.prefs.save(patch);
    ctx.store.set(patch);
  });
  heads.addEventListener("contextmenu", (e) => { e.preventDefault(); showColumnsMenu(ctx, { x: e.clientX, y: e.clientY }); });
}
