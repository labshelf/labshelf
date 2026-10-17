// Orders the gallery's template list by use count or by name.

import type { TemplateEntry } from "./templateEntry.js";

export type TemplateSort = "most-used" | "name";

/** A new array in the given order; ties and entries without a count keep their original relative order. */
export function sortTemplates<T extends TemplateEntry>(entries: readonly T[], sort: TemplateSort): T[] {
  const sorted = [...entries];
  // Array.prototype.sort is stable, so a comparator that returns 0 keeps the input order.
  if (sort === "name") return sorted.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  return sorted.sort((a, b) => {
    if (a.downloads === undefined || b.downloads === undefined) return Number(a.downloads === undefined) - Number(b.downloads === undefined);
    return b.downloads - a.downloads;
  });
}
