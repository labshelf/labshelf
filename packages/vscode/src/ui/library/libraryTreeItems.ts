// Shapes the scope, folder and paper rows of the Library tree as VS Code TreeItems.
import * as vscode from 'vscode';
import { ROOT_LABEL, STATUS_LABEL } from '@labshelf/core';
import type { StatusIcon, ThemedIcon } from '../index.js';
import type { LibraryNode, PaperNode, ScopeNode } from './libraryNode.js';

export function scopeTreeItem({ scope, count }: ScopeNode, statusIcon: StatusIcon): vscode.TreeItem {
  const item = new vscode.TreeItem(scope === 'all' ? ROOT_LABEL : STATUS_LABEL[scope], vscode.TreeItemCollapsibleState.None);
  item.id = `labshelf:scope:${scope}`;
  item.description = String(count);
  item.iconPath = scope === 'all' ? new vscode.ThemeIcon('library') : statusIcon(scope);
  item.command = { command: 'labshelf.openListScope', title: 'Open', arguments: [scope] };
  return item;
}

/** Every folder row, not just leaves, opens in the list panel on click. */
export function folderTreeItem(node: LibraryNode, count: number, hasChildren: boolean): vscode.TreeItem {
  const item = new vscode.TreeItem(
    node.label,
    hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
  );
  item.id = node.dirPath;
  item.iconPath = vscode.ThemeIcon.Folder;
  item.contextValue = 'labshelfFolder';
  item.tooltip = node.dirPath;
  item.resourceUri = vscode.Uri.file(node.dirPath);
  if (count > 0) { item.description = String(count); }
  item.command = { command: 'labshelf.openListTab', title: 'Open', arguments: [node] };
  return item;
}

export function paperTreeItem({ paperId, title }: PaperNode, icon: ThemedIcon): vscode.TreeItem {
  const item = new vscode.TreeItem(title, vscode.TreeItemCollapsibleState.None);
  // Folder ids are absolute paths, so this prefix cannot collide with one even when a paper id equals a folder name.
  item.id = `labshelf:paper:${paperId}`;
  item.iconPath = icon;
  item.contextValue = 'paper';
  item.command = { command: 'labshelf.revealPaper', title: 'Reveal', arguments: [paperId] };
  return item;
}
