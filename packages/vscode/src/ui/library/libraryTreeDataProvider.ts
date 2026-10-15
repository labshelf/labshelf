/**
 * Provides the VS Code tree view for the LabShelf library: an "All Papers" entry plus the collection folders under papers/. Every row opens in the list panel, shows its paper count, and accepts PDF drops and folder drags.
 */
import * as vscode from 'vscode';
import { PAPERS_DIR, findNode, folderTreeFromSnapshot, type CountedFolder, type LibrarySnapshot, type PathOps } from '@labshelf/core';
import { rootNode } from './libraryNode.js';
import type { LibraryNode } from './libraryNode.js';
import { onPaperChange, type LibraryEvents } from "../../events/index.js";

export type { LibraryNode } from './libraryNode.js';

/** The active library's current snapshot, or undefined while none is configured; read on every request, so a reload shows on the next refresh. */
type SnapshotSource = () => LibrarySnapshot | undefined;

const ROOT_ITEM_ID = 'labshelf:all-papers';
const REFRESH_DEBOUNCE_MS = 60;

export class LibraryTreeDataProvider implements vscode.TreeDataProvider<LibraryNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<LibraryNode | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private _papersRoot: vscode.Uri | null;
  private _tree: { snapshot: LibrarySnapshot; folders: CountedFolder[] } | null = null;
  private _refreshTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    papersRoot: vscode.Uri | null,
    private readonly _getSnapshot: SnapshotSource,
    events: LibraryEvents,
    private readonly _paths: PathOps,
  ) {
    this._papersRoot = papersRoot;
    // A folder move emits one paper:updated per paper, so event refreshes are coalesced.
    const refresh = (): void => this._scheduleRefresh();
    onPaperChange(events, refresh);
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
  async getTreeItem(node: LibraryNode): Promise<vscode.TreeItem> {
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
   * Returns the child folders of a node. The top level is "All Papers" followed by the folders directly under papers/.
   * @returns A promise resolving to an array of LibraryNode objects.
   */
  async getChildren(node?: LibraryNode): Promise<LibraryNode[]> {
    if (node?.isRoot) {
      return [];
    }
    if (node) {
      return this._children(node.dirPath);
    }
    const root = this.rootNode();
    if (!root) {
      return [];
    }
    return [root, ...this._children(root.dirPath)];
  }

  /**
   * Returns the parent LibraryNode for a given node, or null when the node is at the top level.
   * @returns The parent LibraryNode, or null.
   */
  getParent(node: LibraryNode): vscode.ProviderResult<LibraryNode> {
    const root = this._papersRoot?.fsPath;
    if (!root || node.isRoot) {
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

// text/uri-list carries OS file drops (PDF import). The tree mime carries folders
// dragged inside this tree; its name is fixed by VS Code from the view id.
const URI_LIST_MIME = 'text/uri-list';
const TREE_MIME = 'application/vnd.code.tree.labshelf.library';

export class LibraryDragAndDropController implements vscode.TreeDragAndDropController<LibraryNode> {
  readonly dropMimeTypes = [URI_LIST_MIME, TREE_MIME];
  readonly dragMimeTypes = [TREE_MIME];

  constructor(
    private readonly onFileDrop: (uris: vscode.Uri[], targetDir: string | undefined) => Promise<void>,
    private readonly onFolderMove?: (sourceDirs: string[], targetDir: string | undefined) => Promise<void>,
  ) {}

  /**
   * Puts the dragged folders on the transfer. "All Papers" is not a real folder and cannot be dragged.
   */
  handleDrag(source: readonly LibraryNode[], dataTransfer: vscode.DataTransfer): void {
    const dirs = source.filter((n) => !n.isRoot).map((n) => n.dirPath);
    if (dirs.length > 0) {
      dataTransfer.set(TREE_MIME, new vscode.DataTransferItem(dirs));
    }
  }

  /**
   * Routes a drop: folders dragged within the tree are moved, OS files are imported. A drop on "All Papers" or on the empty area targets papers/.
   */
  async handleDrop(target: LibraryNode | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
    const targetDir = target?.dirPath;

    const dragged = dataTransfer.get(TREE_MIME)?.value as unknown;
    if (Array.isArray(dragged) && dragged.length > 0) {
      const dirs = dragged.filter((d): d is string => typeof d === 'string');
      if (dirs.length > 0 && this.onFolderMove) {
        await this.onFolderMove(dirs, targetDir);
      }
      return;
    }

    const item = dataTransfer.get(URI_LIST_MIME);
    if (!item) {
      return;
    }

    const raw = await item.asString();
    const uris = raw
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .flatMap((line) => {
        try {
          return [vscode.Uri.parse(line, true)];
        } catch {
          return [];
        }
      })
      .filter((u) => u.scheme === 'file');

    if (uris.length > 0) {
      await this.onFileDrop(uris, targetDir);
    }
  }
}
