// Numbers the treegrid's rows for assistive tech, so a windowed list still announces the full row count and positions.
import type { OpenExtent } from "./openExtent.js";

/**
 * Sets `aria-rowcount` on the grid (the column heads, every paper and the open paper's tray rows) and `aria-rowindex`
 * on the heads and every rendered paper and tray row. Call after the rows and the tray are painted.
 */
export function paintAriaRows(list: HTMLElement, heads: HTMLElement, indexOf: ReadonlyMap<string, number>, open: OpenExtent): void {
  const openIdx = open.id === null ? -1 : (indexOf.get(open.id) ?? -1);
  const trayRows = openIdx < 0 ? 0 : open.rows;
  list.setAttribute("aria-rowcount", String(1 + indexOf.size + trayRows));
  heads.setAttribute("aria-rowindex", "1");
  list.querySelectorAll<HTMLElement>(".paper-row").forEach((unit) => {
    const idx = indexOf.get(unit.dataset["id"] ?? "");
    if (idx === undefined) return;
    const rowIndex = 2 + idx + (openIdx >= 0 && openIdx < idx ? trayRows : 0);
    unit.querySelector(".paper-row-main")?.setAttribute("aria-rowindex", String(rowIndex));
    if (idx !== openIdx) return;
    unit.querySelectorAll('.paper-children [role="row"]').forEach((r, j) => r.setAttribute("aria-rowindex", String(rowIndex + 1 + j)));
  });
}
