// Describes the Writing view rows of a project's reading list and turns them into tree items.
import * as vscode from "vscode";

import { STATUS_LABEL, type PaperStatus, type ReadingList, type ReadingListEntry } from "@labshelf/core";
import type { ReadyProject } from "../figures/index.js";

/** The "Reading list" row below a project. */
export interface ReadingListNode {
  kind: "readingList";
  project: ReadyProject;
  list: ReadingList;
}

export interface ReadingPaperNode {
  kind: "readingPaper";
  project: ReadyProject;
  entry: ReadingListEntry;
}

interface ReadingWarningNode {
  kind: "readingWarning";
  project: ReadyProject;
  neverOpened: number;
}

export type ReadingNode = ReadingListNode | ReadingPaperNode | ReadingWarningNode;

const READING_LIST_CONTEXT = "labshelfReadingList";
const ADDED_PAPER_CONTEXT = "labshelfReadingPaperAdded";
const CITED_PAPER_CONTEXT = "labshelfReadingPaper";

const STATUS_ICON: Record<PaperStatus, string> = { unread: "circle-outline", reading: "play-circle", done: "pass" };

/** The rows below the "Reading list" row: the never-opened warning first, then the papers. */
export function readingListChildren(node: ReadingListNode): ReadingNode[] {
  const { project, list } = node;
  const warning: ReadingNode[] = list.neverOpened > 0 ? [{ kind: "readingWarning", project, neverOpened: list.neverOpened }] : [];
  return [...warning, ...list.entries.map((entry): ReadingNode => ({ kind: "readingPaper", project, entry }))];
}

function paperItem({ project, entry }: ReadingPaperNode): vscode.TreeItem {
  const { paper, key } = entry;
  const item = new vscode.TreeItem(paper?.title ?? key, vscode.TreeItemCollapsibleState.None);
  item.id = `${project.folder}#reading:${key}`;
  const origin = entry.cited ? "cited" : "added";
  item.description = `${paper ? STATUS_LABEL[paper.status] : "Not in the library"} · ${origin}`;
  item.tooltip = `${key}\n${project.settings.id}: ${origin}`;
  item.iconPath = new vscode.ThemeIcon(paper ? STATUS_ICON[paper.status] : "question");
  item.contextValue = entry.cited ? CITED_PAPER_CONTEXT : ADDED_PAPER_CONTEXT;
  if (paper) { item.command = { command: "labshelf.openPdfViewer", title: "Open Paper", arguments: [paper.id] }; }
  return item;
}

export function readingTreeItem(node: ReadingNode): vscode.TreeItem {
  if (node.kind === "readingPaper") { return paperItem(node); }
  const { project } = node;
  if (node.kind === "readingWarning") {
    const item = new vscode.TreeItem(`You cite ${node.neverOpened} ${node.neverOpened === 1 ? "paper" : "papers"} you never opened`, vscode.TreeItemCollapsibleState.None);
    item.id = `${project.folder}#reading:warning`;
    item.iconPath = new vscode.ThemeIcon("warning");
    return item;
  }
  const count = node.list.entries.length;
  const item = new vscode.TreeItem("Reading list", count > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
  item.id = `${project.folder}#reading`;
  item.description = String(count);
  item.iconPath = new vscode.ThemeIcon("checklist");
  item.contextValue = READING_LIST_CONTEXT;
  return item;
}
