// Renders one Checklist row as a tree item: its Arc mark, label, description and click command.
import * as path from "node:path";
import * as vscode from "vscode";

import { STATUS_LABEL, type ArcProgress, type ArcTone, type ChecklistItem, type ChecklistGrouping, type PaperStatus } from "@labshelf/core";
import type { ArcIcon } from "../../ui/index.js";
import type { ReadyProject } from "../figures/index.js";
import { REVEAL_OUTLINE_COMMAND } from "../outline/index.js";
import type { ChecklistNode } from "./checklistNodes.js";

export const NEXT_STATUS_COMMAND = "labshelf.writing.checklist.nextStatus";
const ADD_TO_READING_LIST_COMMAND = "labshelf.writing.addToReadingList";
const MANUAL_CONTEXT = "labshelfChecklistManual";

interface ChecklistItemContext {
  project: ReadyProject;
  grouping: ChecklistGrouping;
  isExpanded: (groupId: string) => boolean;
  arcIcon: ArcIcon;
}

const STATUS_MARK: Record<PaperStatus, [ArcTone, ArcProgress]> = { unread: ["accent", "none"], reading: ["accent", "half"], done: ["ok", "full"] };

function marked(label: string, tooltip: string, mark: [ArcTone, ArcProgress], context: ChecklistItemContext): vscode.TreeItem {
  const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
  item.tooltip = tooltip;
  item.iconPath = context.arcIcon(...mark);
  return item;
}

/** A source location row: the 1-based `file:line` as description, and a click that opens the file at that line. */
function located(item: vscode.TreeItem, file: string, line: number, context: ChecklistItemContext): vscode.TreeItem {
  item.description = `${file}:${line + 1}`;
  const range = new vscode.Range(line, 0, line, 0);
  item.command = { command: REVEAL_OUTLINE_COMMAND, title: "Open", arguments: [vscode.Uri.file(path.join(context.project.folder, file)), range] };
  return item;
}

function readingItem(node: ChecklistNode, entry: Extract<ChecklistItem, { kind: "reading" }>, context: ChecklistItemContext): vscode.TreeItem {
  const { status, statusChangedAt } = entry.paper;
  const item = marked(entry.paper.title, STATUS_LABEL[status], STATUS_MARK[status], context);
  if (status === "done" && statusChangedAt) { item.description = statusChangedAt.slice(0, 10); }
  item.command = { command: NEXT_STATUS_COMMAND, title: "Next status", arguments: [node] };
  return item;
}

function checklistItem(node: ChecklistNode, entry: ChecklistItem, context: ChecklistItemContext): vscode.TreeItem {
  switch (entry.kind) {
    case "todo": return located(marked(entry.todo.text, "TODO", ["warn", "none"], context), entry.todo.file, entry.todo.line, context);
    case "ref": return located(marked(`\\ref{${entry.ref.ref}}`, "Broken reference", ["err", "none"], context), entry.ref.file, entry.ref.line, context);
    case "figure": return marked(entry.figure.name, "Stale figure", ["warn", "none"], context);
    case "pages": return marked(`${entry.overflow.pages} of ${entry.overflow.limit} pages`, "Over the page limit", ["err", "none"], context);
    case "reading": return readingItem(node, entry, context);
    case "manual": {
      const item = marked(entry.manual.text, "Manual item", entry.done ? ["ok", "full"] : ["accent", "none"], context);
      item.checkboxState = entry.done ? vscode.TreeItemCheckboxState.Checked : vscode.TreeItemCheckboxState.Unchecked;
      item.contextValue = MANUAL_CONTEXT;
      return item;
    }
  }
}

export function checklistTreeItem(node: ChecklistNode, context: ChecklistItemContext): vscode.TreeItem {
  switch (node.type) {
    case "group": {
      const expanded = context.isExpanded(node.group.id);
      const item = new vscode.TreeItem(node.group.title, expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
      item.id = `${context.grouping}:${node.group.id}`;
      item.description = node.group.open > 0 ? String(node.group.open) : "";
      return item;
    }
    case "read": return new vscode.TreeItem(`${node.children.length} read`, vscode.TreeItemCollapsibleState.Collapsed);
    case "addPaper": {
      const item = new vscode.TreeItem("+ Add paper", vscode.TreeItemCollapsibleState.None);
      item.command = { command: ADD_TO_READING_LIST_COMMAND, title: "Add paper", arguments: [context.project] };
      return item;
    }
    case "item": return checklistItem(node, node.item, context);
  }
}
