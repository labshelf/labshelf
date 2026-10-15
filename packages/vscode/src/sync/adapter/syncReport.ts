/** Shows a sync outcome in the status bar and, where the user should know, as a toast. */
import * as vscode from "vscode";

import { describeSyncOutcome, type SyncOutcome } from "@labshelf/core";

/**
 * Reports one outcome. Routine ones (nothing changed, another app syncing, signed out) show only when the user asked
 * for the sync: another app's changes arrive through the file watcher anyway.
 */
export function reportSyncOutcome(statusBar: vscode.StatusBarItem, outcome: SyncOutcome, manual: boolean): void {
  if (outcome.kind === "synced") { statusBar.text = `$(cloud) LabShelf (${new Date().toLocaleTimeString()})`; }
  if (outcome.kind === "busy") { statusBar.text = "$(cloud) LabShelf"; }
  if (outcome.kind === "failed") { statusBar.text = "$(sync-ignored) LabShelf"; }
  const notice = describeSyncOutcome(outcome);
  if (notice.routine && !manual) { return; }
  const text = `LabShelf: ${notice.needsSignIn ? `${notice.text} — connect to Google Drive from the status bar` : notice.text}`;
  if (notice.severity === "error") { vscode.window.showErrorMessage(text); }
  else if (notice.severity === "warn" && outcome.kind !== "busy") { vscode.window.showWarningMessage(text); }
  else { vscode.window.setStatusBarMessage(text, 6000); }
}
