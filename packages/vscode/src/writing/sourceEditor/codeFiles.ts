// The code files the LabShelf editor's listings link to: which files count as code, reading one inside the workspace folders, and the feed that tells open panels a code file changed.
// CONTRACT: documents/contracts/library-format.md#code-listings
import * as vscode from "vscode";

import { CODE_FILE_GLOB, createDebouncer } from "@labshelf/core";
import { isCodeFile } from "../codeSource.js";

/** The changes of a burst of saves and disk writes reach the panels once, this long after the last. */
const CODE_CHANGE_DELAY_MS = 300;

/** Whether `target` lies inside one of the window's workspace folders. */
function isInWorkspace(target: vscode.Uri): boolean {
  return (vscode.workspace.workspaceFolders ?? []).some(({ uri }) => {
    if (uri.scheme !== target.scheme || uri.authority !== target.authority) { return false; }
    const root = uri.path.endsWith("/") ? uri.path : `${uri.path}/`;
    return target.path.startsWith(root);
  });
}

/** The file a path relative to the project folder names; it may climb out with `../` but must stay inside a workspace folder, else it throws. */
export function resolveCodeFile(projectRoot: vscode.Uri | undefined, path: string): vscode.Uri {
  if (!projectRoot) { throw new Error("outside the project"); }
  if (path.startsWith("/") || path.includes("\\") || /^[A-Za-z]:/.test(path)) { throw new Error("not a project-relative path"); }
  // joinPath normalises the `..` segments, so the check below sees where the path really lands.
  const target = vscode.Uri.joinPath(projectRoot, path);
  if (!isInWorkspace(target)) { throw new Error("outside the workspace folders"); }
  return target;
}

/**
 * The text of a code file named relative to the project folder; it may climb out with `../` but must stay inside a workspace folder, else it throws.
 * Null when the file does not exist; the open TextDocument's text when it is open.
 */
export async function readCodeFile(projectRoot: vscode.Uri | undefined, path: string): Promise<string | null> {
  const target = resolveCodeFile(projectRoot, path);
  const key = target.toString();
  const open = vscode.workspace.textDocuments.find((document) => document.uri.toString() === key);
  if (open) { return open.getText(); }
  try {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(target));
  } catch (error) {
    if (error instanceof vscode.FileSystemError && error.code === "FileNotFound") { return null; }
    throw error;
  }
}

/** Tells its listeners, debounced, that a code file was saved or changed on disk; one watcher serves every panel and runs only while one listens. */
export interface CodeChangeFeed {
  subscribe(listener: () => void): vscode.Disposable;
}

export function createCodeChangeFeed(): CodeChangeFeed {
  const listeners = new Set<() => void>();
  let watching: vscode.Disposable | undefined;
  const notify = createDebouncer(() => { for (const listener of [...listeners]) { listener(); } }, CODE_CHANGE_DELAY_MS);
  const onUri = (uri: vscode.Uri): void => { if (isCodeFile(uri.path)) { notify.call(); } };
  const start = (): vscode.Disposable => {
    const watcher = vscode.workspace.createFileSystemWatcher(CODE_FILE_GLOB);
    return vscode.Disposable.from(
      watcher, watcher.onDidChange(onUri), watcher.onDidCreate(onUri), watcher.onDidDelete(onUri),
      vscode.workspace.onDidSaveTextDocument((document) => onUri(document.uri)),
    );
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      watching ??= start();
      return new vscode.Disposable(() => {
        listeners.delete(listener);
        if (listeners.size > 0) { return; }
        notify.cancel();
        watching?.dispose();
        watching = undefined;
      });
    },
  };
}
