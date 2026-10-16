// Builds the Projects view rows: section headings, project rows with their open-count mark, and the detail lines under a project.
import * as vscode from "vscode";

import type { ProjectEntry, ReadingList } from "@labshelf/core";
import type { ArcIcon } from "../../ui/index.js";

const OPEN_MAIN_COMMAND = "labshelf.writing.openProject";

export interface SectionNode { kind: "section"; location: ProjectEntry["location"] }
export interface DetailNode { kind: "detail"; label: string }
export type ProjectNode = ProjectEntry | SectionNode | DetailNode;
export type ReadyEntry = Extract<ProjectEntry, { kind: "ready" }>;

export interface Counted { open: number; stale: number }
export interface LastBuild { ok: boolean; at: Date }

const SECTION_LABELS: Record<ProjectEntry["location"], string> = { library: "In library", external: "External folders" };

export function sectionItem(node: SectionNode): vscode.TreeItem {
  const item = new vscode.TreeItem(SECTION_LABELS[node.location], vscode.TreeItemCollapsibleState.Expanded);
  item.id = `section:${node.location}`;
  item.contextValue = "labshelfWritingSection";
  return item;
}

export function detailItem(node: DetailNode): vscode.TreeItem {
  const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
  item.contextValue = "labshelfWritingDetail";
  return item;
}

const suffix = (entry: ProjectEntry): string => (entry.location === "external" ? "External" : "");

export function brokenItem(entry: Extract<ProjectEntry, { kind: "broken" }>, arcIcon: ArcIcon): vscode.TreeItem {
  const item = new vscode.TreeItem(entry.folder.split(/[\\/]/).pop() ?? entry.folder, vscode.TreeItemCollapsibleState.None);
  item.id = entry.folder;
  item.contextValue = `labshelfProjectBroken${suffix(entry)}`;
  item.description = "folder missing";
  item.iconPath = arcIcon("err", "full");
  item.tooltip = `${entry.folder}\n${entry.reason}`;
  return item;
}

function mark(counted: Counted | undefined, build: LastBuild | undefined): { tone: "accent" | "err" | "warn" | "ok"; label: string } {
  if (!counted) { return { tone: "accent", label: "Counting…" }; }
  if (build && !build.ok) { return { tone: "err", label: "Last build failed" }; }
  return counted.open > 0 ? { tone: "warn", label: `${counted.open} open` } : { tone: "ok", label: "Nothing open" };
}

export function readyItem(entry: ReadyEntry, counted: Counted | undefined, build: LastBuild | undefined, arcIcon: ArcIcon): vscode.TreeItem {
  const item = new vscode.TreeItem(entry.settings.id, vscode.TreeItemCollapsibleState.Collapsed);
  const { tone, label } = mark(counted, build);
  item.id = entry.folder;
  item.contextValue = `labshelfProject${suffix(entry)}`;
  item.iconPath = arcIcon(tone, counted ? "full" : "none");
  if (counted) { item.description = `${counted.open} open`; }
  item.tooltip = entry.location === "external" ? `${label}\n${entry.folder}` : label;
  item.command = { command: OPEN_MAIN_COMMAND, title: "Open Main Document", arguments: [entry] };
  return item;
}

const pad = (value: number): string => String(value).padStart(2, "0");

function engineOf(entry: ReadyEntry): string {
  if (entry.settings.format === "typst") { return "typst"; }
  return entry.settings.engine ?? "compiler not chosen";
}

/** One line per fact worth a glance; the reading and stale-figure lines appear only when they have something to say. */
export function detailLines(entry: ReadyEntry, counted: Counted | undefined, build: LastBuild | undefined, reading: ReadingList): string[] {
  const lines = [`${entry.main ?? "no main file"} · ${engineOf(entry)}`];
  if (build) { lines.push(`Last build ${build.ok ? "succeeded" : "failed"} ${pad(build.at.getHours())}:${pad(build.at.getMinutes())}`); }
  const inLibrary = reading.entries.filter((candidate) => candidate.paper);
  if (inLibrary.length > 0) {
    lines.push(`Reading ${inLibrary.filter((candidate) => candidate.paper?.status === "done").length} of ${inLibrary.length}`);
  }
  if (counted && counted.stale > 0) { lines.push(`${counted.stale} stale figures`); }
  return lines;
}
