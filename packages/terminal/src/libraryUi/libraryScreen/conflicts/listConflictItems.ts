// Builds the labels and choices the conflict overlay shows for sync conflict copies.
import * as path from "node:path";

import { formatConflictOwnerLabel, listConflictAskChoices, type ConflictCopy, type ConflictResolution } from "@labshelf/core";

import type { PickerItem } from "../../overlays.js";

const DETAILS: Partial<Record<ConflictResolution, string>> = {
  keepMine: "deletes the other copy",
  keepOther: "replaces your file with the other copy",
  keepBoth: "saves the other copy as (copy N)",
};

/** "2 conflicts" for the status bar; empty when there are none. */
export function formatConflictCount(count: number): string {
  return count === 0 ? "" : `${count} conflict${count === 1 ? "" : "s"}`;
}

/** One picker row per copy: the paper's title (its id when the store lacks it), the project id or "Space <id>", the file name and the sync tool. */
export function listConflictItems(copies: readonly ConflictCopy[], titleOf: (paperId: string) => string | undefined): PickerItem[] {
  return copies.map((copy, index) => ({
    id: String(index),
    label: `${formatConflictOwnerLabel(copy.owner, copy.owner.kind === "paper" ? titleOf(copy.owner.id) : undefined)} · ${path.basename(copy.original)}`,
    detail: copy.tool,
  }));
}

export function listConflictChoices(copy: ConflictCopy): PickerItem[] {
  return listConflictAskChoices(copy).map(({ resolution, label }) => ({
    id: resolution, label, ...(resolution === "mergeMyself" || !DETAILS[resolution] ? {} : { detail: DETAILS[resolution] }),
  }));
}
