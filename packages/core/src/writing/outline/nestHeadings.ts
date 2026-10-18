// Nests level-tagged headings so each runs to the next heading of the same or a higher level.

/** A heading with the headings below it and the heading that ends its section. */
export interface HeadingNode<T extends { level: number }> {
  entry: T;
  /** The next heading of the same or a higher level; undefined when the section runs to the end of the file. */
  next: T | undefined;
  children: HeadingNode<T>[];
}

/** @param entries headings in text order; a smaller level is higher, and only the order between levels matters */
export function nestHeadings<T extends { level: number }>(entries: readonly T[]): HeadingNode<T>[] {
  const roots: HeadingNode<T>[] = [];
  const open: HeadingNode<T>[] = [];
  entries.forEach((entry, index) => {
    const node: HeadingNode<T> = { entry, next: entries.slice(index + 1).find((later) => later.level <= entry.level), children: [] };
    while (open.length > 0 && open[open.length - 1]!.entry.level >= entry.level) { open.pop(); }
    (open[open.length - 1]?.children ?? roots).push(node);
    open.push(node);
  });
  return roots;
}
