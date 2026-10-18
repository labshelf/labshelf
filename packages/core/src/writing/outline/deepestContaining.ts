// Finds the deepest node of a tree that holds a position, for marking the current heading.

/** Of siblings that touch at a boundary the later one wins, so a cursor on a section's first line belongs to that section. */
export function deepestContaining<T extends { children: readonly T[] }>(nodes: readonly T[], contains: (node: T) => boolean): T | undefined {
  const holder = [...nodes].reverse().find(contains);
  return holder && (deepestContaining(holder.children, contains) ?? holder);
}
