// Maps a Continue target to the Library tree row that opens it.
import * as vscode from "vscode";

import type { ContinueTarget } from "../../continue/index.js";

/** A row at the top of the Library tree that reopens the paper or file the user left. */
export interface ContinueNode {
  target: ContinueTarget;
}

export function isContinueNode(node: object): node is ContinueNode {
  return "target" in node;
}

export function continueTreeItem({ target }: ContinueNode): vscode.TreeItem {
  if (target.kind === "paper") {
    const item = new vscode.TreeItem(`Continue: ${target.title}`, vscode.TreeItemCollapsibleState.None);
    item.id = "labshelf:continue-paper";
    item.description = `page ${target.page}`;
    item.iconPath = new vscode.ThemeIcon("book");
    item.command = { command: "labshelf.openPdfViewer", title: "Open", arguments: [target.paperId, target.page] };
    return item;
  }
  const item = new vscode.TreeItem(`Continue: ${target.projectId}`, vscode.TreeItemCollapsibleState.None);
  item.id = "labshelf:continue-project";
  item.description = target.relativeFile;
  item.iconPath = new vscode.ThemeIcon("edit");
  const at = new vscode.Position(target.line, target.character);
  item.command = { command: "vscode.open", title: "Open", arguments: [vscode.Uri.file(target.file), { selection: new vscode.Range(at, at) }] };
  return item;
}
