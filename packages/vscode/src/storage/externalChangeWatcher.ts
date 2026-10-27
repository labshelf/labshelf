// Detects library changes made outside this window (terminal app, sync, file manager) and triggers a re-index.
// Watches papers/**, the sidecars and projects/** (conflict copies of writing projects); a burst of events is debounced into one re-index.
import * as vscode from "vscode";

import { SIDECAR_FILE, createDebouncer, isExternalChangeNoise, type Debouncer, type LibraryLayout } from "@labshelf/core";
import { disposeAll } from "../disposables/index.js";

const DEBOUNCE_MS = 1_000;

export class ExternalChangeWatcher implements vscode.Disposable {
  private readonly watchers: vscode.FileSystemWatcher[] = [];
  private readonly reindex: Debouncer<[]>;

  constructor(paths: LibraryLayout<vscode.Uri>, private readonly onChange: () => void, private readonly debounceMs = DEBOUNCE_MS) {
    this.reindex = createDebouncer(() => this.onChange(), this.debounceMs);
    const patterns = [
      new vscode.RelativePattern(paths.papersRoot(), "**"),
      new vscode.RelativePattern(paths.paperDataRoot(), `**/${SIDECAR_FILE}`),
      new vscode.RelativePattern(paths.projectsRoot(), "**"),
    ];
    for (const pattern of patterns) {
      const watcher = vscode.workspace.createFileSystemWatcher(pattern);
      const schedule = (uri: vscode.Uri): void => this.schedule(uri);
      watcher.onDidCreate(schedule);
      watcher.onDidChange(schedule);
      watcher.onDidDelete(schedule);
      this.watchers.push(watcher);
    }
  }

  private schedule(uri: vscode.Uri): void {
    if (isExternalChangeNoise(uri.fsPath)) { return; }
    this.reindex.call();
  }

  dispose(): void {
    this.reindex.cancel();
    disposeAll(this.watchers);
  }
}
