// Builds the quick-pick item that lists a library paper by title, cite key, status and year.
import type * as vscode from "vscode";

import { derivePaperPickText, type PaperRecord } from "@labshelf/core";

export interface PaperPickItem extends vscode.QuickPickItem {
  paper: PaperRecord;
}

export function paperPickItem(paper: PaperRecord): PaperPickItem {
  return { ...derivePaperPickText(paper), paper };
}
