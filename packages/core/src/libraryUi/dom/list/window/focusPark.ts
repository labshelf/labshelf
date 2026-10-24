// Keeps keyboard focus in the grid when its focused row is rendered away, and returns it to the row when it renders again.
import { focusedRow, paperRowOf } from "../tree/index.js";

const PARKED = "data-parked";

/**
 * Call before the rows are repainted; the returned function, called after, parks focus on the grid element when the
 * focused row was removed (the browser would move it to `body`) and restores it to the cursor row once that renders.
 */
export function parkFocus(list: HTMLElement, cursor: () => string | null): () => void {
  const hadRow = focusedRow(list) !== null;
  return () => {
    const active = document.activeElement;
    if (hadRow && !list.contains(active) && (active === document.body || active === null)) {
      list.setAttribute(PARKED, "");
      list.addEventListener("blur", () => list.removeAttribute(PARKED), { once: true });
      list.focus({ preventScroll: true });
      return;
    }
    if (active !== list || !list.hasAttribute(PARKED)) return;
    const row = paperRowOf(list, cursor());
    if (!row) return;
    list.removeAttribute(PARKED);
    row.focus({ preventScroll: true });
  };
}
