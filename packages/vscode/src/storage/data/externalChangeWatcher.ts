// Detects library changes made outside this window (terminal app, sync, file manager) and triggers a re-index.
// Watches papers/** and the sidecars; a burst of events is debounced into one re-index.
import * as vscode from "vscode";

import { SIDECAR_FILE, isExternalChangeNoise, type LibraryLayout } from "@labshelf/core";

const DEBOUNCE_MS = 1_000;

export class ExternalChangeWatcher implements vscode.Disposable {
  private readonly watchers: vscode.FileSystemWatcher[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(paths: LibraryLayout<vscode.Uri>, private readonly onChange: () => void, private readonly debounceMs = DEBOUNCE_MS) {
    const patterns = [
      new vscode.RelativePattern(paths.papersRoot(), "**"),
      new vscode.RelativePattern(paths.paperDataRoot(), `**/${SIDECAR_FILE}`),
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
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.onChange(), this.debounceMs);
  }

  dispose(): void {
    clearTimeout(this.timer);
    for (const watcher of this.watchers) { watcher.dispose(); }
  }
}
