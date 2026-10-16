// Turns a built checklist into the Checklist view's rows: groups, items, the folded "N read" row and the Add paper row.
import type { Checklist, ChecklistGroup, ChecklistItem } from "@labshelf/core";

type ReadingChecklistItem = Extract<ChecklistItem, { kind: "reading" }>;

export type ChecklistNode =
  | { type: "group"; group: ChecklistGroup; children: ChecklistNode[] }
  | { type: "item"; item: ChecklistItem }
  | { type: "read"; children: ChecklistNode[] }
  | { type: "addPaper" };

/** The group that ends with the Add paper row, in either grouping. */
const READING_GROUP_IDS = new Set(["reading", "#reading"]);

const isDoneReading = (item: ChecklistItem): item is ReadingChecklistItem => item.kind === "reading" && item.done;

/** Newest status change first; papers without a date go last. */
function newestFirst(a: ReadingChecklistItem, b: ReadingChecklistItem): number {
  const left = a.paper.statusChangedAt ?? "";
  const right = b.paper.statusChangedAt ?? "";
  return right.localeCompare(left);
}

function groupChildren(group: ChecklistGroup): ChecklistNode[] {
  const done = group.items.filter(isDoneReading).sort(newestFirst);
  const children: ChecklistNode[] = group.items.filter((item) => !isDoneReading(item)).map((item) => ({ type: "item", item }));
  if (done.length > 0) { children.push({ type: "read", children: done.map((item) => ({ type: "item", item })) }); }
  if (READING_GROUP_IDS.has(group.id)) { children.push({ type: "addPaper" }); }
  return children;
}

export function checklistNodes(checklist: Checklist): ChecklistNode[] {
  return checklist.groups.map((group) => ({ type: "group", group, children: groupChildren(group) }));
}
