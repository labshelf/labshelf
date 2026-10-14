/**
 * Column sorting for the list on the core record order, and the direction a column starts in when first clicked.
 */
import { recordComparator, type PaperSortKey } from "../../library/index.js";
import type { SortDir, SortKey } from "../state/index.js";
import type { ListPaper } from "./listPapers.js";

const CORE_SORT_KEY: Record<SortKey, PaperSortKey> = {
  title: "title", creator: "author", year: "year", publication: "publication", status: "status",
};

/** Sorts by the chosen column with title as the tiebreaker. Returns a new array. */
export function sortPapers(papers: ListPaper[], key: SortKey, dir: SortDir): ListPaper[] {
  // Core orders years newest first; the ascending arrow (dir 1) means oldest first, so year reads the direction the other way round.
  const reverse = key === "year" ? dir === 1 : dir === -1;
  return [...papers].sort(recordComparator({ key: CORE_SORT_KEY[key], reverse }));
}

/** The direction a column sorts in on its first click: dates newest first, everything else A to Z. */
export function firstSortDir(key: SortKey): SortDir {
  return key === "year" ? -1 : 1;
}
