/** Moves folders dragged inside the Library tree and imports PDFs dropped from the OS. */
import * as vscode from 'vscode';
import { isFolderNode, type LibraryTreeNode } from './libraryNode.js';

// text/uri-list carries OS file drops (PDF import). The tree mime carries folders
// dragged inside this tree; its name is fixed by VS Code from the view id.
const URI_LIST_MIME = 'text/uri-list';
const TREE_MIME = 'application/vnd.code.tree.labshelf.library';

export class LibraryDragAndDropController implements vscode.TreeDragAndDropController<LibraryTreeNode> {
  readonly dropMimeTypes = [URI_LIST_MIME, TREE_MIME];
  readonly dragMimeTypes = [TREE_MIME];

  constructor(
    private readonly onFileDrop: (uris: vscode.Uri[], targetDir: string | undefined) => Promise<void>,
    private readonly onFolderMove?: (sourceDirs: string[], targetDir: string | undefined) => Promise<void>,
  ) {}

  /**
   * Puts the dragged folders on the transfer. Only folder rows drag, and the papers/ root is not one.
   */
  handleDrag(source: readonly LibraryTreeNode[], dataTransfer: vscode.DataTransfer): void {
    const dirs = source.flatMap((n) => (isFolderNode(n) && !n.isRoot ? [n.dirPath] : []));
    if (dirs.length > 0) {
      dataTransfer.set(TREE_MIME, new vscode.DataTransferItem(dirs));
    }
  }

  /**
   * Routes a drop: folders dragged within the tree are moved, OS files are imported. A drop on a row that is not a folder, or on the empty area, targets papers/.
   */
  async handleDrop(target: LibraryTreeNode | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
    const targetDir = target && isFolderNode(target) ? target.dirPath : undefined;

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
