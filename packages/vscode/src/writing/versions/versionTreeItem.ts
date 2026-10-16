// Builds the tree item of one version row: its name, date and the command that opens its PDF.
import * as vscode from "vscode";

import type { VersionRow } from "./projectVersionsView.js";

export const OPEN_VERSION_COMMAND = "labshelf.writing.openVersion";

export function versionTreeItem(row: VersionRow): vscode.TreeItem {
  const { version, project, hasPdf } = row;
  const item = new vscode.TreeItem(version.name, vscode.TreeItemCollapsibleState.None);
  item.id = `${project.folder}:${version.slug}`;
  item.iconPath = new vscode.ThemeIcon("history");
  if (hasPdf) {
    item.description = new Date(version.created).toLocaleDateString();
    item.contextValue = "labshelfVersion";
    item.command = { command: OPEN_VERSION_COMMAND, title: "Open Version", arguments: [row] };
  } else {
    item.description = "PDF missing";
    item.contextValue = "labshelfVersionMissing";
  }
  item.tooltip = new Date(version.created).toLocaleString();
  return item;
}
