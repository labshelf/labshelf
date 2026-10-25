// Opens the menu that shows or hides the optional list columns.
import { showMenu, type MenuAnchor } from "../../../ui/dom/index.js";
import { COLUMN_KEYS, type ListColumn } from "../../store/index.js";
import type { UiContext } from "../uiContext.js";

const LABEL: Record<ListColumn, string> = { creator: "Authors", venue: "Venue", year: "Year", lastRead: "Last read", status: "Status" };

function toggleColumn(ctx: UiContext, key: ListColumn): void {
  const s = ctx.store.get();
  const columns = COLUMN_KEYS.filter((k) => (k === key) !== s.columns.includes(k));
  // A hidden column cannot stay the sort, since nothing on screen shows the order.
  const patch = s.sortKey === key && !columns.includes(key) ? { columns, sortKey: "title" as const, sortDir: 1 as const } : { columns };
  ctx.prefs.save(patch);
  ctx.store.set(patch);
}

/** Opens the columns menu at a point or under an element. */
export function showColumnsMenu(ctx: UiContext, at: MenuAnchor | HTMLElement): void {
  const shown = ctx.store.get().columns;
  showMenu(at, COLUMN_KEYS.map((key) => ({ label: LABEL[key], checked: shown.includes(key), onSelect: () => toggleColumn(ctx, key) })));
}
