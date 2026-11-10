// The feed that tells the LabShelf editor's open panels that a code file their listings may link to changed; reading one is codeSource.ts.
// CONTRACT: documents/contracts/library-format.md#code-listings
import * as vscode from "vscode";

import { CODE_FILE_GLOB, createDebouncer } from "@labshelf/core";
import { isCodeFile } from "../codeSource.js";

/** The changes of a burst of saves and disk writes reach the panels once, this long after the last. */
const CODE_CHANGE_DELAY_MS = 300;

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
