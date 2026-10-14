/** Removes papers from the library after one confirmation: their folders go to the trash. */
import * as vscode from "vscode";

import type { PaperRecord } from "@labshelf/core";
import type { PaperService } from "../core/index.js";

const REMOVE = "Remove";

/** A paper whose folder cannot be trashed stays in the list, and the user is told why. */
export async function removePapers(paperService: PaperService, papers: PaperRecord[]): Promise<void> {
  if (papers.length === 0) { return; }
  const what = papers.length === 1 ? `"${papers[0]!.title}"` : `${papers.length} papers`;
  const choice = await vscode.window.showWarningMessage(
    `Remove ${what} from the library?`,
    { modal: true, detail: "The folder and its files move to the trash, on this device and on every synced device." },
    REMOVE,
  );
  if (choice !== REMOVE) { return; }
  const outcome = await paperService.trashPapers(papers.map((paper) => paper.id));
  const firstFailure = outcome.failed[0];
  if (firstFailure) {
    const title = papers.find((paper) => paper.id === firstFailure.id)?.title ?? firstFailure.id;
    const others = outcome.failed.length > 1 ? ` (and ${outcome.failed.length - 1} more)` : "";
    void vscode.window.showErrorMessage(`LabShelf: Could not move "${title}"${others} to the trash — ${firstFailure.error}`);
  }
  if (outcome.done.length > 0) {
    vscode.window.setStatusBarMessage(`LabShelf: removed ${outcome.done.length === 1 && !firstFailure ? what : `${outcome.done.length} papers`}`, 3000);
  }
}
