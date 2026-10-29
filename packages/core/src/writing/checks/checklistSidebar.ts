/** Lays a built checklist out as the sidebar's Checklist tree: ordered groups with dots, the folded "N read" rows and the manual items, and renders each item as a row. */
import type { DotKind, SidebarTreeNode } from "../../libraryUi/index.js";
import { formatShortDate } from "../../time/index.js";
import type { PathOps } from "../../path/index.js";
import { STATUS_LABEL, deriveFamilyName, type ReadingStatus } from "../../library/index.js";
import type { Checklist, ChecklistGroup, ChecklistGrouping, ChecklistItem, PageOverflow } from "./checklist.js";

// --- Item rows ---

/** What the Checklist knows about a reading-list paper beyond its checklist item. */
export interface ReadingPaper {
  paperId: string;
  cited: boolean;
  listed: boolean;
  authors?: string[] | undefined;
  year?: number | undefined;
}

type ReadingChecklistItem = Extract<ChecklistItem, { kind: "reading" }>;

/** @returns a key unique to the item within its group and stable across refreshes */
function createItemKey(item: ChecklistItem): string {
  switch (item.kind) {
    case "todo": return `todo:${item.todo.file}:${item.todo.line}`;
    case "noteTask": return `noteTask:${item.task.file}:${item.task.itemId}:${item.task.line}`;
    case "ref": return `ref:${item.ref.file}:${item.ref.line}:${item.ref.ref}`;
    case "figure": return `figure:${item.figure.name}`;
    case "pages": return "pages";
    case "manual": return `manual:${item.manual.id}`;
    case "reading": return `reading:${item.paper.key}`;
  }
}

/** A source location row: `<file stem>:<line>` as description and a click that opens it. */
function located(paths: PathOps, key: string, label: string, file: string, line: number, tooltip = `${file}:${line + 1}`): SidebarTreeNode {
  return { key, label, description: `${paths.basename(file, paths.extname(file))}:${line + 1}`, tooltip, clickable: true };
}

const pagesText = (pages: number): string => Number.isInteger(pages) ? String(pages) : pages.toFixed(1);

/** The Pages row's head: the body's page count against its limit, red once over it. */
function createPagesHead({ pages, limit }: PageOverflow): Omit<SidebarTreeNode, "key"> {
  const over = pages > limit;
  return {
    label: `Pages ${pagesText(pages)} / ${limit}`, tooltip: over ? "Over the page limit" : "Within the page limit",
    icon: { kind: "dot", tone: over ? "err" : "ok" },
  };
}

const STATUS_TONE: Record<ReadingStatus, DotKind> = { unread: "muted", reading: "accent", done: "ok" };

function readingRow(key: string, item: ReadingChecklistItem, paper: ReadingPaper | undefined): SidebarTreeNode {
  const { title, status, statusChangedAt } = item.paper;
  const author = paper?.authors?.find((a) => a.trim().length > 0);
  const label = author ? [deriveFamilyName(author), paper?.year].filter((part) => part !== undefined).join(" ") : title;
  const description = item.done
    ? statusChangedAt && formatShortDate(statusChangedAt)
    : paper?.cited ? "cited" : paper?.listed ? "added" : undefined;
  return {
    key, label, tooltip: title, ...(description ? { description } : {}),
    trailing: { icon: { kind: "dot", tone: STATUS_TONE[status] }, tooltip: STATUS_LABEL[status], action: "nextStatus" },
  };
}

function createItemRow(paths: PathOps, key: string, item: ChecklistItem, reading: ReadonlyMap<string, ReadingPaper>, noteTitles: ReadonlyMap<string, string>): SidebarTreeNode {
  switch (item.kind) {
    case "todo": return located(paths, key, item.todo.text, item.todo.file, item.todo.line);
    case "noteTask": return {
      ...located(paths, key, item.task.text, item.task.file, item.task.line, noteTitles.get(item.task.file) ?? item.task.file),
      checked: item.done, ...(item.done ? { struck: true } : {}),
    };
    case "ref": return located(paths, key, `\\ref{${item.ref.ref}}`, item.ref.file, item.ref.line);
    case "figure": return { key, label: item.figure.name, tooltip: "Stale figure", inlineAction: { action: "regenerate", label: "Regenerate" } };
    case "pages": return { key, ...createPagesHead(item.overflow) };
    case "manual": return {
      key, label: item.manual.text, checked: item.done, ...(item.done ? { struck: true } : {}),
      menu: [{ label: "Remove Item", action: "removeItem", danger: true }],
    };
    case "reading": return readingRow(key, item, reading.get(item.paper.key));
  }
}

// --- Sidebar tree ---

export interface ChecklistTreeInput {
  paths: PathOps;
  checklist: Checklist;
  grouping: ChecklistGrouping;
  /** Shown as the Pages row in By kind; undefined without a page limit or a count. */
  pageCount: PageOverflow | undefined;
  reading: ReadonlyMap<string, ReadingPaper>;
  /** Note file to note title, the tooltip of a note task row. */
  noteTitles: ReadonlyMap<string, string>;
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

interface KindHead { title: string; tone: (g: ChecklistGroup) => DotKind }

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
    const rowKey = `${key}/${createItemKey(item)}`;
    tree.items.set(rowKey, item);
    return createItemRow(input.paths, rowKey, item, input.reading, input.noteTitles);
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
  const head = input.pageCount ? createPagesHead(input.pageCount) : { label: "Pages", icon: { kind: "dot", tone: "muted" } as const };
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
function sectionTone(group: ChecklistGroup): DotKind {
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

export function deriveChecklistSidebarNodes(input: ChecklistTreeInput): ChecklistTree {
  const tree: ChecklistTree = { nodes: [], items: new Map(), groups: new Map() };
  tree.nodes = input.grouping === "kind" ? byKind(input, tree) : bySection(input, tree);
  return tree;
}
