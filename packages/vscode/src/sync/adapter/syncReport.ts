/** Shows a sync outcome in the status bar and, where the user should know, as a toast. */
import * as vscode from "vscode";

import type { SyncOutcome } from "@labshelf/core";

/**
 * Reports one outcome. Busy and signed-out runs stay quiet unless the user asked for the sync: another app's changes
 * arrive through the file watcher anyway.
 */
export function reportSyncOutcome(statusBar: vscode.StatusBarItem, outcome: SyncOutcome, manual: boolean): void {
  switch (outcome.kind) {
    case "synced": {
      const { record } = outcome;
      const total = record.uploaded + record.downloaded + record.deletedLocal + record.deletedRemote;
      statusBar.text = `$(cloud) LabShelf (${new Date().toLocaleTimeString()})`;
      if (record.conflicts.length > 0) {
        vscode.window.showWarningMessage(
          `LabShelf Sync: ${record.conflicts.length} conflict(s) detected. Duplicate files saved with a "(conflict)" suffix.`,
        );
      } else if (total > 0) {
        vscode.window.setStatusBarMessage(`LabShelf Sync: ${total} file(s) synced`, 4000);
      }
      return;
    }
    case "busy": {
      statusBar.text = "$(cloud) LabShelf";
      if (!manual) { return; }
      const who = outcome.holder?.app === "terminal" ? "The LabShelf terminal app" : "Another LabShelf window";
      vscode.window.setStatusBarMessage(`LabShelf Sync: ${who} is syncing this library right now.`, 6000);
      return;
    }
    case "skipped":
      if (manual) { vscode.window.showWarningMessage("LabShelf Sync: connect to Google Drive first."); }
      return;
    case "failed":
      statusBar.text = "$(sync-ignored) LabShelf";
      vscode.window.showErrorMessage(`LabShelf Sync: ${outcome.error}`);
  }
}
