/**
 * Provides the VS Code tree view for the LabShelf library: Continue rows, the status scope rows, then the collection folders under papers/ with their papers, from the core library tree.
 */
import * as vscode from 'vscode';
import { PAPERS_DIR, folderTreeFromSnapshot, libraryTree, type LibrarySnapshot, type LibraryTree, type PathOps, type TreeChild } from '@labshelf/core';
import { isFolderNode, type LibraryNode, type LibraryTreeNode, type PaperNode } from './libraryNode.js';
import { onPaperChange, type LibraryEvents } from "../../events/index.js";
import type { ContinueSource } from "../../continue/index.js";
import { refIcon, statusIcons, type StatusIcon, type ThemedIcon } from "../index.js";
import { continueTreeItem, isContinueNode } from './continueNode.js';
import { folderTreeItem, paperTreeItem, scopeTreeItem } from './libraryTreeItems.js';

export type { LibraryNode } from './libraryNode.js';

/** The active library's current snapshot, or undefined while none is configured; read on every request, so a reload shows on the next refresh. */
type SnapshotSource = () => LibrarySnapshot | undefined;

const REFRESH_DEBOUNCE_MS = 60;

export class LibraryTreeDataProvider implements vscode.TreeDataProvider<LibraryTreeNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<LibraryTreeNode | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private _papersRoot: vscode.Uri | null;
  private _tree: { snapshot: LibrarySnapshot; tree: LibraryTree } | null = null;
  private _refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly _statusIcon: StatusIcon;
  private readonly _refIcon: ThemedIcon;

  constructor(
    papersRoot: vscode.Uri | null,
    private readonly _getSnapshot: SnapshotSource,
    events: LibraryEvents,
    private readonly _paths: PathOps,
    private readonly _continue: ContinueSource,
    extensionUri: vscode.Uri,
  ) {
    this._papersRoot = papersRoot;
    this._statusIcon = statusIcons(extensionUri);
    this._refIcon = refIcon(extensionUri);
    // A folder move emits one paper:updated per paper, so event refreshes are coalesced.
    const refresh = (): void => this._scheduleRefresh();
    onPaperChange(events, refresh);
    // A reader closing has just saved its page; a project cursor is saved by the recorder.
    events.pdfViewerClosed.event(refresh);
    _continue.onDidChange(refresh);
  }

  /**
   * Points the tree at a library's papers root, then refreshes; called after workspace setup completes.
   */
  setLibrary(papersRoot: vscode.Uri): void {
    this._papersRoot = papersRoot;
    this.refresh();
  }

  /**
   * Fires onDidChangeTreeData so VS Code re-reads the tree from the current snapshot.
   */
  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  async getTreeItem(node: LibraryTreeNode): Promise<vscode.TreeItem> {
    if (isContinueNode(node)) { return continueTreeItem(node); }
    if ('scope' in node) { return scopeTreeItem(node, this._statusIcon); }
    if ('paperId' in node) { return paperTreeItem(node, this._refIcon); }
    const children = this._childrenAt(node.dirPath);
    const count = this._folderChild(node.dirPath)?.count ?? 0;
    return folderTreeItem(node, count, children.length > 0);
  }

  /**
   * Returns a row's children: the top level is the Continue rows, the scope rows, then papers/ itself (its folders, then its papers); a folder holds its subfolders, then its papers.
   */
  async getChildren(node?: LibraryTreeNode): Promise<LibraryTreeNode[]> {
    if (node) {
      return isFolderNode(node) ? this._childrenAt(node.dirPath).map((c) => this._toNode(c)) : [];
    }
    const tree = this._currentTree();
    if (!tree) { return []; }
    const rows = (await this._continue.targets()).map((target) => ({ target }));
    return [...rows, ...tree.scopes(), ...tree.children(PAPERS_DIR).map((c) => this._toNode(c))];
  }

  /**
   * Returns the row that holds a row: a folder, or null at the top level.
   */
  getParent(node: LibraryTreeNode): vscode.ProviderResult<LibraryNode> {
    const ui = isFolderNode(node) ? this._parentUi(node.dirPath)
      : 'paperId' in node ? this._currentTree()?.parentOf(node.paperId) : undefined;
    return ui && ui !== PAPERS_DIR ? this._folderNode(ui) : null;
  }

  /** The row of a paper in the current tree, or undefined when the library has no paper with this id. */
  paperNode(id: string): PaperNode | undefined {
    const tree = this._currentTree();
    const parent = tree?.parentOf(id);
    const child = parent === undefined ? undefined : tree?.children(parent).find((c) => c.kind === 'paper' && c.id === id);
    return child?.kind === 'paper' ? { paperId: child.id, title: child.title } : undefined;
  }

  private _currentTree(): LibraryTree | undefined {
    const snapshot = this._getSnapshot();
    if (!snapshot || !this._papersRoot) { return undefined; }
    if (this._tree?.snapshot !== snapshot) {
      const papers = [...snapshot.papers.values()].map(({ record, collection }) =>
        ({ record, folder: collection ? `${PAPERS_DIR}/${collection}` : PAPERS_DIR }));
      this._tree = { snapshot, tree: libraryTree({ folders: folderTreeFromSnapshot(snapshot), papers }) };
    }
    return this._tree.tree;
  }

  private _childrenAt(dirPath: string): TreeChild[] {
    const ui = this._uiPath(dirPath);
    return ui ? this._currentTree()?.children(ui) ?? [] : [];
  }

  /** The tree's entry for a folder, which carries its recursive count. */
  private _folderChild(dirPath: string): Extract<TreeChild, { kind: 'folder' }> | undefined {
    const ui = this._uiPath(dirPath);
    const parent = this._parentUi(dirPath);
    const match = parent ? this._currentTree()?.children(parent).find((c) => c.kind === 'folder' && c.path === ui) : undefined;
    return match?.kind === 'folder' ? match : undefined;
  }

  private _toNode(child: TreeChild): LibraryTreeNode {
    return child.kind === 'folder' ? this._folderNode(child.path) : { paperId: child.id, title: child.title };
  }

  private _folderNode(ui: string): LibraryNode {
    const segments = ui.split('/').slice(1);
    return { label: segments[segments.length - 1] ?? '', dirPath: this._paths.join(this._papersRoot?.fsPath ?? '', ...segments) };
  }

  /** Maps a folder's file-system path to its UI path ("papers/A/B"); undefined outside papers/. */
  private _uiPath(dirPath: string): string | undefined {
    const root = this._papersRoot?.fsPath;
    if (!root) { return undefined; }
    if (dirPath === root) { return PAPERS_DIR; }
    if (!dirPath.startsWith(root + this._paths.sep)) { return undefined; }
    return [PAPERS_DIR, ...dirPath.slice(root.length + 1).split(this._paths.sep)].join('/');
  }

  private _parentUi(dirPath: string): string | undefined {
    const ui = this._uiPath(dirPath);
    return ui && ui !== PAPERS_DIR ? ui.slice(0, ui.lastIndexOf('/')) : undefined;
  }

  private _scheduleRefresh(): void {
    if (this._refreshTimer) {
      clearTimeout(this._refreshTimer);
    }
    this._refreshTimer = setTimeout(() => {
      this._refreshTimer = null;
      this.refresh();
    }, REFRESH_DEBOUNCE_MS);
  }
}
