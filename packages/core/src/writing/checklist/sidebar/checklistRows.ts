// Renders one Checklist item as a sidebar row: its label, location or status, and what clicking it does.
import type { DotKind, SidebarTreeNode } from "../../../libraryUi/index.js";
import { formatShortDate } from "../../../time/index.js";
import type { PathOps } from "../../../path/index.js";
import { STATUS_LABEL, deriveFamilyName, type ReadingStatus } from "../../../library/record.js";
import type { ChecklistItem, PageOverflow } from "../buildChecklist.js";

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
export function createItemKey(item: ChecklistItem): string {
  switch (item.kind) {
    case "todo": return `todo:${item.todo.file}:${item.todo.line}`;
    case "ref": return `ref:${item.ref.file}:${item.ref.line}:${item.ref.ref}`;
    case "figure": return `figure:${item.figure.name}`;
    case "pages": return "pages";
    case "manual": return `manual:${item.manual.id}`;
    case "reading": return `reading:${item.paper.key}`;
  }
}

/** A source location row: `<file stem>:<line>` as description and a click that opens it. */
function located(paths: PathOps, key: string, label: string, file: string, line: number): SidebarTreeNode {
  const at = line + 1;
  return { key, label, description: `${paths.basename(file, paths.extname(file))}:${at}`, tooltip: `${file}:${at}`, clickable: true };
}

const pagesText = (pages: number): string => Number.isInteger(pages) ? String(pages) : pages.toFixed(1);

/** The Pages row's head: the body's page count against its limit, red once over it. */
export function createPagesHead({ pages, limit }: PageOverflow): Omit<SidebarTreeNode, "key"> {
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

export function createItemRow(paths: PathOps, key: string, item: ChecklistItem, reading: ReadonlyMap<string, ReadingPaper>): SidebarTreeNode {
  switch (item.kind) {
    case "todo": return located(paths, key, item.todo.text, item.todo.file, item.todo.line);
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
