// Orders the items of a merged file: base order, with each side's added items after their preceding base item.
// CONTRACT: documents/contracts/qmd-items.md#merge

const START = "";

/**
 * Every key of the three sides once. Items of the base keep base order. Items added on one side follow the base item
 * that precedes them on that side, as one run; when both sides add a run at the same place, the run whose first id is
 * smaller (created earlier) goes first. An item both sides added keeps local's place.
 */
export function mergedOrder(base: readonly string[], local: readonly string[], other: readonly string[]): string[] {
  const inBase = new Set(base);
  const localRuns = addedRuns(local, inBase, new Set());
  const otherRuns = addedRuns(other, inBase, new Set(local));
  const order: string[] = [];
  for (const slot of [START, ...base]) {
    if (slot !== START) { order.push(slot); }
    const runs = [localRuns.get(slot) ?? [], otherRuns.get(slot) ?? []].filter((run) => run.length > 0);
    runs.sort((a, b) => (a[0]! < b[0]! ? -1 : 1));
    for (const run of runs) { order.push(...run); }
  }
  return order;
}

/** Added keys of one side grouped by the base key before them (START for the file start), skipping `taken` keys. */
function addedRuns(keys: readonly string[], inBase: ReadonlySet<string>, taken: ReadonlySet<string>): Map<string, string[]> {
  const runs = new Map<string, string[]>();
  let slot = START;
  for (const key of keys) {
    if (inBase.has(key)) {
      slot = key;
    } else if (!taken.has(key)) {
      runs.set(slot, [...runs.get(slot) ?? [], key]);
    }
  }
  return runs;
}
