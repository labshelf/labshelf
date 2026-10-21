// Counts project checklist progress for Space goals.
import { buildChecklist, type ChecklistSignals, type ReadingItem } from "../../writing/index.js";
import type { Progress } from "./viewTypes.js";

export function spaceChecklistProgress(signals: ChecklistSignals, reading: readonly ReadingItem[]): Progress {
  const checklist = buildChecklist({
    ...signals, reading, pageOverflow: undefined,
    placeSection: file => ({ id: file, title: file, file }), citeSections: new Map(),
  }, "kind");
  const items = checklist.groups.flatMap(group => group.items);
  return { done: items.filter(item => item.done).length, total: items.length };
}
