// Builds the labels and choices the conflict overlay shows for sync conflict copies.
import * as path from "node:path";

import { conflictResolutions, type ConflictCopy, type ConflictResolution } from "@labshelf/core";

import type { PickerItem } from "../../overlays.js";

const CHOICES: Array<{ id: ConflictResolution; label: string; detail: string }> = [
  { id: "keepMine", label: "Keep mine", detail: "deletes the other copy" },
  { id: "keepOther", label: "Keep the other", detail: "replaces your file with the other copy" },
  { id: "keepBoth", label: "Keep both", detail: "saves the other copy as (copy N)" },
];

/** "2 conflicts" for the status bar; empty when there are none. */
export function conflictCountLabel(count: number): string {
  return count === 0 ? "" : `${count} conflict${count === 1 ? "" : "s"}`;
}

/** One picker row per copy: the paper's title (its id when the store lacks it) or the project id, the file name and the sync tool. */
export function conflictItems(copies: readonly ConflictCopy[], titleOf: (paperId: string) => string | undefined): PickerItem[] {
  return copies.map((copy, index) => ({
    id: String(index),
    label: `${(copy.owner.kind === "paper" ? titleOf(copy.owner.id) : undefined) ?? copy.owner.id} · ${path.basename(copy.original)}`,
    detail: copy.tool,
  }));
}

export function conflictChoices(copy: ConflictCopy): PickerItem[] {
  const allowed = conflictResolutions(copy);
  return CHOICES.filter((choice) => allowed.includes(choice.id));
}
