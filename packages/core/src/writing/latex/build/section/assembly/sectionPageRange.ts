/** Finds the pages of the full PDF a section covers, from the pages its heading and the next heading were recorded on. */
import type { SectionState } from "../sectionStateFile.js";

export interface PageRange {
  /** 0-based index of the first page. */
  start: number;
  /** 0-based index of the last page, inclusive. */
  end: number;
}

// INVARIANT: a record is written before its command runs. The page a next `\section` is recorded on holds this section's
// tail; a next `\chapter` or `\part` is recorded before its `\clearpage`, on the page holding this section's tail too.
// So the next record's page always ends the range. A page-clearing heading's own range may start one page early: when
// the page it clears was not empty, the range shows the previous tail page rather than risk missing the first page.
export function sectionPageRange(states: readonly SectionState[], sectionIndex: number, fullPageCount: number): PageRange {
  const state = states[sectionIndex];
  if (!state) { throw new Error(`sectionPageRange: no section state ${sectionIndex} of ${states.length}`); }
  const last = fullPageCount - 1;
  const next = states[sectionIndex + 1];
  const end = Math.min(next ? next.absolutePage - 1 : last, last);
  return { start: Math.min(state.absolutePage - 1, end), end };
}
