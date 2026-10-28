/** Orders papers by a sort key with title as the tie-break, and finds what changed between two readings of the library
 * by structural comparison of the records; one rule set for every app. */
import { deriveVenue, type PaperRecord } from "../model/index.js";
import { PAPER_STATUSES, deriveFamilyName } from "./record.js";
import type { PaperEntry, SortSpec } from "./libraryStore.js";

/** Numeric, accent- and case-insensitive: "Paper 2" sorts before "Paper 10". */
export const nameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function compareRecords(key: SortSpec["key"], a: PaperRecord, b: PaperRecord): number {
  switch (key) {
    case "author":
      return nameCollator.compare(deriveFamilyName(a.authors?.[0] ?? ""), deriveFamilyName(b.authors?.[0] ?? ""));
    case "venue":
      return nameCollator.compare(deriveVenue(a), deriveVenue(b));
    case "year":
      // Newest first; `reverse` flips it.
      return (b.year ?? 0) - (a.year ?? 0);
    case "status":
      return PAPER_STATUSES.indexOf(a.status) - PAPER_STATUSES.indexOf(b.status);
    default:
      return 0;
  }
}

interface ItemAccess<T> {
  record: (item: T) => PaperRecord;
  modifiedMs: (item: T) => number;
  lastRead: (item: T) => string | undefined;
}

// Years, reading times and venues: an item without one sorts after those with one, whichever way the list runs.
function missingLast(a: unknown, b: unknown): number {
  return (a === undefined) === (b === undefined) ? 0 : a === undefined ? 1 : -1;
}

function comparatorFor<T>(sort: SortSpec, access: ItemAccess<T>) {
  const sign = sort.reverse ? -1 : 1;
  return (a: T, b: T): number => {
    const ra = access.record(a);
    const rb = access.record(b);
    if (sort.key === "year") {
      const missing = missingLast(ra.year, rb.year);
      if (missing) { return missing; }
    }
    if (sort.key === "venue") {
      const missing = missingLast(deriveVenue(ra) || undefined, deriveVenue(rb) || undefined);
      if (missing) { return missing; }
    }
    if (sort.key === "lastRead") {
      const [la, lb] = [access.lastRead(a), access.lastRead(b)];
      const missing = missingLast(la, lb);
      if (missing) { return missing; }
      const primary = la && lb ? lb.localeCompare(la) : 0;
      return sign * (primary || nameCollator.compare(ra.title, rb.title));
    }
    const primary = sort.key === "modified" ? access.modifiedMs(b) - access.modifiedMs(a) : compareRecords(sort.key, ra, rb);
    return sign * (primary || nameCollator.compare(ra.title, rb.title));
  };
}

/** @returns a comparator over scanned papers; "modified" puts the most recently changed first */
export function createPaperComparator(sort: SortSpec): (a: PaperEntry, b: PaperEntry) => number {
  return comparatorFor<PaperEntry>(sort, { record: (entry) => entry.record, modifiedMs: (entry) => entry.modifiedMs, lastRead: () => undefined });
}

/**
 * Bare records carry no modification time, so "modified" falls back to the title; `lastRead` gives each paper's last
 * reading time (ISO) for the "lastRead" key.
 * @returns a comparator over bare records
 */
export function createPaperRecordComparator(
  sort: SortSpec,
  lastRead: (record: PaperRecord) => string | undefined = () => undefined,
): (a: PaperRecord, b: PaperRecord) => number {
  return comparatorFor<PaperRecord>(sort, { record: (record) => record, modifiedMs: () => 0, lastRead });
}

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
