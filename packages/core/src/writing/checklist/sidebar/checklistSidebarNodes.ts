// Lays a built checklist out as the sidebar's Checklist tree: ordered groups with dots, the folded "N read" rows and the manual items.
import type { DotTone, SidebarTreeNode } from "../../../libraryUi/index.js";
import type { PathOps } from "../../../library/mutations/index.js";
import type { Checklist, ChecklistGroup, ChecklistGrouping, ChecklistItem, PageOverflow } from "../buildChecklist.js";
import { itemKey, itemRow, pagesHead, type ReadingPaper } from "./checklistRows.js";

type ReadingChecklistItem = Extract<ChecklistItem, { kind: "reading" }>;

export interface ChecklistTreeInput {
  paths: PathOps;
  checklist: Checklist;
  grouping: ChecklistGrouping;
  /** Shown as the Pages row in By kind; undefined without a page limit or a count. */
  pageCount: PageOverflow | undefined;
  reading: ReadonlyMap<string, ReadingPaper>;
  isExpanded: (groupId: string, byDefault: boolean) => boolean;
}

export interface ChecklistTree {
  nodes: SidebarTreeNode[];
  /** Every item row's checklist item by its key. */
  items: Map<string, ChecklistItem>;
  /** Every group row's checklist group id by its key. */
  groups: Map<string, string>;
}

const OPEN_BY_DEFAULT = new Set(["reading", "manual", "#reading"]);

interface KindHead { title: string; tone: (g: ChecklistGroup) => DotTone }

/** By kind groups in display order; "pages" is the Pages row, built from the page count. */
const KIND_ORDER: Array<[string, KindHead | undefined]> = [
  ["ref", { title: "References", tone: () => "err" }],
  ["todo", { title: "TODOs", tone: () => "warn" }],
  ["figure", { title: "Figures", tone: () => "warn" }],
  ["reading", { title: "Reading", tone: () => "muted" }],
  ["pages", undefined],
  ["manual", { title: "My items", tone: (g) => g.open === 0 ? "ok" : "muted" }],
];

const ADDABLE = { placeholder: "Add item" };

const isDoneReading = (item: ChecklistItem): item is ReadingChecklistItem => item.kind === "reading" && item.done;

/** Newest status change first; papers without a date go last. */
const newestFirst = (a: ReadingChecklistItem, b: ReadingChecklistItem): number =>
  (b.paper.statusChangedAt ?? "").localeCompare(a.paper.statusChangedAt ?? "");

function groupNode(input: ChecklistTreeInput, tree: ChecklistTree, group: ChecklistGroup, head: Omit<SidebarTreeNode, "key">): SidebarTreeNode {
  const key = `${input.grouping}:${group.id}`;
  tree.groups.set(key, group.id);
  const row = (item: ChecklistItem): SidebarTreeNode => {
    const rowKey = `${key}/${itemKey(item)}`;
    tree.items.set(rowKey, item);
    return itemRow(input.paths, rowKey, item, input.reading);
  };
  // Manual items follow the group's own rows, the folded "N read" row included.
  const own = group.items.filter((item) => item.kind !== "manual" || group.id === "manual" || group.id.startsWith("#"));
  const manual = group.items.filter((item) => !own.includes(item));
  const children = own.filter((item) => !isDoneReading(item)).map(row);
  const done = own.filter(isDoneReading).sort(newestFirst);
  if (done.length > 0) { children.push({ key: `${key}/read`, label: `${done.length} read`, dim: true, open: false, children: done.map(row) }); }
  children.push(...manual.map(row));
  return { key, ...head, open: input.isExpanded(group.id, OPEN_BY_DEFAULT.has(group.id)), children };
}

/** The Pages row from the page count, folding over the manual items added to it; a leaf without them. */
function pagesNode(input: ChecklistTreeInput, tree: ChecklistTree, group: ChecklistGroup | undefined): SidebarTreeNode | undefined {
  const manual = group?.items.filter((item) => item.kind === "manual") ?? [];
  const head = input.pageCount ? pagesHead(input.pageCount) : { label: "Pages", icon: { kind: "dot", tone: "muted" } as const };
  if (manual.length === 0) {
    if (!input.pageCount) { return undefined; }
    tree.groups.set("kind:pages", "pages");
    return { key: "kind:pages", ...head, addable: ADDABLE };
  }
  return groupNode(input, tree, { id: "pages", title: "Pages", items: manual, open: manual.filter((item) => !item.done).length }, { ...head, addable: ADDABLE });
}

function byKind(input: ChecklistTreeInput, tree: ChecklistTree): SidebarTreeNode[] {
  const groups = new Map(input.checklist.groups.map((g) => [g.id, g]));
  const nodes: SidebarTreeNode[] = [];
  for (const [id, head] of KIND_ORDER) {
    const group = groups.get(id);
    if (!head) {
      const node = pagesNode(input, tree, group);
      if (node) { nodes.push(node); }
      continue;
    }
    if (!group) { continue; }
    nodes.push(groupNode(input, tree, group, { label: head.title, icon: { kind: "dot", tone: head.tone(group) }, addable: ADDABLE }));
  }
  return nodes;
}

/** A section's worst open item: errors (broken reference, page overflow), then warnings (TODO, stale figure), then anything open. */
function sectionTone(group: ChecklistGroup): DotTone {
  if (group.id === "#reading") { return "muted"; }
  const open = group.items.filter((item) => !item.done);
  if (open.some((item) => item.kind === "ref" || item.kind === "pages")) { return "err"; }
  if (open.some((item) => item.kind === "todo" || item.kind === "figure")) { return "warn"; }
  return open.length > 0 ? "muted" : "ok";
}

function bySection(input: ChecklistTreeInput, tree: ChecklistTree): SidebarTreeNode[] {
  return input.checklist.groups.map((group) => groupNode(input, tree, group, {
    label: group.title, icon: { kind: "dot", tone: sectionTone(group) }, ...(group.id === "#reading" ? {} : { addable: ADDABLE }),
  }));
}

export function checklistSidebarNodes(input: ChecklistTreeInput): ChecklistTree {
  const tree: ChecklistTree = { nodes: [], items: new Map(), groups: new Map() };
  tree.nodes = input.grouping === "kind" ? byKind(input, tree) : bySection(input, tree);
  return tree;
}
