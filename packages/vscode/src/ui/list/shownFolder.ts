// Resolves the folder the list panel shows, falling back to the library root for deleted folders and paths outside papers/.
import * as vscode from 'vscode';
import { isUnderDir, type PathOps } from '@labshelf/core';
import { rootNode, type LibraryNode } from '../library/index.js';

export async function resolveShownFolder(wanted: LibraryNode | undefined, root: string, pathOps: PathOps): Promise<LibraryNode> {
  if (!wanted || wanted.isRoot || wanted.dirPath === root || !isUnderDir(wanted.dirPath, root, pathOps.sep)) { return rootNode(root); }
  try {
    const stat = await vscode.workspace.fs.stat(vscode.Uri.file(wanted.dirPath));
    if (stat.type & vscode.FileType.Directory) { return { label: pathOps.basename(wanted.dirPath), dirPath: wanted.dirPath }; }
  } catch {
    // The folder is gone: fall through to the root.
  }
  return rootNode(root);
}
