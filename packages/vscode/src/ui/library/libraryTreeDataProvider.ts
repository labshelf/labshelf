/**
 * Provides the VS Code tree view for the LabShelf library: Continue rows for the paper read last and the project file edited last, an "All Papers" entry, and the collection folders under papers/. Folder rows open in the list panel and show their paper count.
 */
import * as vscode from 'vscode';
import { PAPERS_DIR, findNode, folderTreeFromSnapshot, type CountedFolder, type LibrarySnapshot, type PathOps } from '@labshelf/core';
import { rootNode } from './libraryNode.js';
import type { LibraryNode, LibraryTreeNode } from './libraryNode.js';
import { onPaperChange, type LibraryEvents } from "../../events/index.js";
import type { ContinueSource } from "../../continue/index.js";
import { continueTreeItem, isContinueNode } from './continueNode.js';

export type { LibraryNode } from './libraryNode.js';

/** The active library's current snapshot, or undefined while none is configured; read on every request, so a reload shows on the next refresh. */
type SnapshotSource = () => LibrarySnapshot | undefined;

const ROOT_ITEM_ID = 'labshelf:all-papers';
const REFRESH_DEBOUNCE_MS = 60;

export class LibraryTreeDataProvider implements vscode.TreeDataProvider<LibraryTreeNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<LibraryTreeNode | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private _papersRoot: vscode.Uri | null;
  private _tree: { snapshot: LibrarySnapshot; folders: CountedFolder[] } | null = null;
  private _refreshTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    papersRoot: vscode.Uri | null,
    private readonly _getSnapshot: SnapshotSource,
    events: LibraryEvents,
    private readonly _paths: PathOps,
    private readonly _continue: ContinueSource,
  ) {
    this._papersRoot = papersRoot;
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

  /**
   * Returns the node for papers/ itself, or null while no library is configured.
   * @returns the root LibraryNode or null
   */
  rootNode(): LibraryNode | null {
    return this._papersRoot ? rootNode(this._papersRoot.fsPath) : null;
  }

  /**
   * Returns the VS Code TreeItem for a node. Every row, not just leaves, opens in the list panel on click.
   * @returns A vscode.TreeItem configured for the given node.
   */
  async getTreeItem(node: LibraryTreeNode): Promise<vscode.TreeItem> {
    if (isContinueNode(node)) { return continueTreeItem(node); }
    const hasChildren = !node.isRoot && this._children(node.dirPath).length > 0;
    const item = new vscode.TreeItem(
      node.label,
      hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
    );
    item.id = node.isRoot ? ROOT_ITEM_ID : node.dirPath;
    item.iconPath = node.isRoot ? new vscode.ThemeIcon('library') : vscode.ThemeIcon.Folder;
    item.contextValue = node.isRoot ? 'labshelfRoot' : 'labshelfFolder';
    item.tooltip = node.dirPath;
    if (!node.isRoot) {
      item.resourceUri = vscode.Uri.file(node.dirPath);
    }

    const count = this._countUnder(node);
    if (count > 0) {
      item.description = String(count);
    }

    item.command = { command: 'labshelf.openListTab', title: 'Open', arguments: [node] };
    return item;
  }

  /**
   * Returns the child folders of a node. The top level is the Continue rows, "All Papers", then the folders directly under papers/.
   * @returns A promise resolving to an array of tree nodes.
   */
  async getChildren(node?: LibraryTreeNode): Promise<LibraryTreeNode[]> {
    if (node && (isContinueNode(node) || node.isRoot)) {
      return [];
    }
    if (node) {
      return this._children(node.dirPath);
    }
    const root = this.rootNode();
    if (!root) {
      return [];
    }
    const rows = (await this._continue.targets()).map((target) => ({ target }));
    return [...rows, root, ...this._children(root.dirPath)];
  }

  /**
   * Returns the parent LibraryNode for a given node, or null when the node is at the top level.
   * @returns The parent LibraryNode, or null.
   */
  getParent(node: LibraryTreeNode): vscode.ProviderResult<LibraryNode> {
    const root = this._papersRoot?.fsPath;
    if (!root || isContinueNode(node) || node.isRoot) {
      return null;
    }
    const parent = this._paths.dirname(node.dirPath);
    if (parent === root || !parent.startsWith(root + this._paths.sep)) {
      return null;
    }
    return { label: this._paths.basename(parent), dirPath: parent };
  }

  private _folders(): CountedFolder[] {
    const snapshot = this._getSnapshot();
    if (!snapshot) { return []; }
    if (this._tree?.snapshot !== snapshot) { this._tree = { snapshot, folders: folderTreeFromSnapshot(snapshot) }; }
    return this._tree.folders;
  }

  private _uiPath(dirPath: string, root: string): string {
    return dirPath === root ? PAPERS_DIR : [PAPERS_DIR, ...dirPath.slice(root.length + 1).split(this._paths.sep)].join('/');
  }

  private _children(dirPath: string): LibraryNode[] {
    const root = this._papersRoot?.fsPath;
    if (!root) { return []; }
    const ui = this._uiPath(dirPath, root);
    const folders = ui === PAPERS_DIR ? this._folders() : this._folderAt(ui)?.children ?? [];
    return folders.map((f) => ({ label: f.name, dirPath: this._paths.join(root, ...f.path.split('/').slice(1)) }));
  }

  private _folderAt(ui: string): CountedFolder | undefined {
    // The tree is built as CountedFolder nodes, so the node findNode returns carries its total.
    return findNode(this._folders(), ui) as CountedFolder | undefined;
  }

  private _countUnder(node: LibraryNode): number {
    const root = this._papersRoot?.fsPath;
    if (!root) { return 0; }
    if (node.isRoot) { return this._getSnapshot()?.papers.size ?? 0; }
    return this._folderAt(this._uiPath(node.dirPath, root))?.total ?? 0;
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
