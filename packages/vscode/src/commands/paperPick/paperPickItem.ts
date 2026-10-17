// Builds the quick-pick item that lists a library paper by title, cite key, status and year.
import type * as vscode from "vscode";

import { STATUS_LABEL, type PaperRecord } from "@labshelf/core";

export interface PaperPickItem extends vscode.QuickPickItem {
  paper: PaperRecord;
}

export function paperPickItem(paper: PaperRecord): PaperPickItem {
  return {
    label: paper.title,
    description: `@${paper.citeKey}`,
    detail: `${STATUS_LABEL[paper.status]}${paper.year ? ` · ${paper.year}` : ""}`,
    paper,
  };
}
