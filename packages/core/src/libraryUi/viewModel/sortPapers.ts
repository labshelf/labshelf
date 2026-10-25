/**
 * Sorts the list by column on the core record order and gives the direction a column starts in when first clicked.
 */
import { createPaperRecordComparator, type PaperSortColumn } from "../../library/index.js";
import type { PaperStats } from "../protocol/index.js";
import type { SortDir, SortColumn } from "../store/index.js";
import type { ListPaper } from "./listPapers.js";

const CORE_SORT_KEY: Record<SortColumn, PaperSortColumn> = {
  title: "title", creator: "author", venue: "venue", year: "year", lastRead: "lastRead", status: "status",
};

// Core orders these newest first; their ascending arrow (dir 1) means oldest first, so they read the direction the other way round.
const NEWEST_FIRST: ReadonlySet<SortColumn> = new Set(["year", "lastRead"]);

/** Sorts by the chosen column with title as the tiebreaker; `stats` gives Last read. Returns a new array. */
export function orderPapers(papers: ListPaper[], key: SortColumn, dir: SortDir, stats: Readonly<Record<string, PaperStats>> = {}): ListPaper[] {
  const reverse = NEWEST_FIRST.has(key) ? dir === 1 : dir === -1;
  return [...papers].sort(createPaperRecordComparator({ key: CORE_SORT_KEY[key], reverse }, (p) => stats[p.id]?.lastRead));
}

/** The direction a column sorts in on its first click: dates newest first, everything else A to Z. */
export function deriveFirstSortDir(key: SortColumn): SortDir {
  return NEWEST_FIRST.has(key) ? -1 : 1;
}
