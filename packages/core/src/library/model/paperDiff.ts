/** Finds what changed between two readings of the library, by structural comparison of the records. */
import type { PaperRecord } from "../../model/index.js";

export interface PaperDiff {
  added: PaperRecord[];
  updated: PaperRecord[];
  removed: PaperRecord[];
  /** Updated papers whose PDF is on this device now and was not before. */
  gainedPdf: PaperRecord[];
}

/** @returns the papers added, changed and removed going from `before` to `after` */
export function comparePapers(before: readonly PaperRecord[], after: readonly PaperRecord[]): PaperDiff {
  const previous = new Map(before.map((paper) => [paper.id, paper]));
  const diff: PaperDiff = { added: [], updated: [], removed: [], gainedPdf: [] };
  for (const paper of after) {
    const old = previous.get(paper.id);
    previous.delete(paper.id);
    if (!old) {
      diff.added.push(paper);
    } else if (stable(old) !== stable(paper)) {
      diff.updated.push(paper);
      if (old.hasPdf === false && paper.hasPdf !== false) { diff.gainedPdf.push(paper); }
    }
  }
  diff.removed.push(...previous.values());
  return diff;
}

// Order-independent serialization, so a record whose fields come back in a different order is not mistaken for a change.
function stable(value: unknown): string {
  if (value === null || typeof value !== "object") { return JSON.stringify(value) ?? "undefined"; }
  if (Array.isArray(value)) { return "[" + value.map(stable).join(",") + "]"; }
  const record = value as Record<string, unknown>;
  return "{" + Object.keys(record).sort().map((key) => JSON.stringify(key) + ":" + stable(record[key])).join(",") + "}";
}
