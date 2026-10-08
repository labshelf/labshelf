/** Orders papers by a sort key with title as the tie-break; one rule set for every app. */
import { PAPER_STATUSES, type PaperRecord } from "../../model/index.js";
import type { PaperEntry, SortSpec } from "./types.js";

/** Numeric, accent- and case-insensitive: "Paper 2" sorts before "Paper 10". */
export const nameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

// "Vaswani, Ashish" and "Ashish Vaswani" both sort under Vaswani.
function familyName(author: string): string {
  return author.includes(",") ? author.split(",")[0]!.trim() : author.trim().split(/\s+/).pop() ?? "";
}

function compareRecords(key: SortSpec["key"], a: PaperRecord, b: PaperRecord): number {
  switch (key) {
    case "author":
      return nameCollator.compare(familyName(a.authors?.[0] ?? ""), familyName(b.authors?.[0] ?? ""));
    case "year":
      // Newest first; `reverse` flips it.
      return (b.year ?? 0) - (a.year ?? 0);
    case "publication":
      return nameCollator.compare(a.journal ?? a.publisher ?? "", b.journal ?? b.publisher ?? "");
    case "status":
      return PAPER_STATUSES.indexOf(a.status) - PAPER_STATUSES.indexOf(b.status);
    default:
      return 0;
  }
}

function comparatorFor<T>(sort: SortSpec, record: (item: T) => PaperRecord, modifiedMs: (item: T) => number) {
  const sign = sort.reverse ? -1 : 1;
  return (a: T, b: T): number => {
    const ra = record(a);
    const rb = record(b);
    // A paper without a year sorts after those with one, whichever way the list runs.
    if (sort.key === "year" && (ra.year === undefined) !== (rb.year === undefined)) { return ra.year === undefined ? 1 : -1; }
    const primary = sort.key === "modified" ? modifiedMs(b) - modifiedMs(a) : compareRecords(sort.key, ra, rb);
    return sign * (primary || nameCollator.compare(ra.title, rb.title));
  };
}

/** @returns a comparator over scanned papers; "modified" puts the most recently changed first */
export function paperComparator(sort: SortSpec): (a: PaperEntry, b: PaperEntry) => number {
  return comparatorFor<PaperEntry>(sort, (entry) => entry.record, (entry) => entry.modifiedMs);
}

/** @returns a comparator over bare records, which carry no modification time: "modified" falls back to the title */
export function recordComparator(sort: SortSpec): (a: PaperRecord, b: PaperRecord) => number {
  return comparatorFor<PaperRecord>(sort, (record) => record, () => 0);
}
