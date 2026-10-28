// Measures how many items two lists share.

/** The size of the multiset intersection: each item of `right` consumes one equal item of `left`. */
export function countCommon<T>(left: readonly T[], right: readonly T[]): number {
  const counts = new Map<T, number>();
  for (const item of left) { counts.set(item, (counts.get(item) ?? 0) + 1); }
  let common = 0;
  for (const item of right) {
    const count = counts.get(item) ?? 0;
    if (count > 0) { common += 1; counts.set(item, count - 1); }
  }
  return common;
}
