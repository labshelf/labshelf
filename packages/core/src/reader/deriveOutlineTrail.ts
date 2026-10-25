// Gives the section and subsection an outline places a page in, for the preview footer's breadcrumb.
import { deriveActiveOutlineRow, type OutlineRow } from "./outlineModel.js";

/**
 * A deeper entry gives its top-level section and that section's child on the way to it.
 * @returns the section first, at most two rows; empty before the first resolved entry.
 */
export function deriveOutlineTrail(rows: readonly OutlineRow[], rowPages: readonly (number | null)[], page: number): OutlineRow[] {
  const active = rows[deriveActiveOutlineRow(rowPages, page)];
  if (!active) { return []; }
  // INVARIANT: a row's id is its index, as `deriveOutlineRows` numbers them.
  const chain: OutlineRow[] = [];
  for (let row: OutlineRow | undefined = active; row; row = row.parentId === null ? undefined : rows[row.parentId]) {
    chain.unshift(row);
  }
  return chain.slice(0, 2);
}
