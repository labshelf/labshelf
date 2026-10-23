// Picks the side of a three-way merge that holds every edit.

/** The side that holds every edit, or undefined when both sides changed the value differently. */
export function changedSide<T>(base: T | undefined, local: T, other: T): T | undefined {
  if (local === other || other === base) { return local; }
  if (local === base) { return other; }
  return undefined;
}
