/** Finds the pages of the full PDF a section covers, from the page its heading lands on and the page the next one starts on. */
import type { SectionState } from "./index.js";

export interface PageRange {
  /** 0-based index of the first page. */
  start: number;
  /** 0-based index of the last page, inclusive. */
  end: number;
}

// INVARIANT: an empty boundary page belongs to the next section; a partially filled page includes this section's tail.
export function sectionPageRange(states: readonly SectionState[], sectionIndex: number, fullPageCount: number): PageRange {
  const state = states[sectionIndex];
  if (!state) { throw new Error(`sectionPageRange: no section state ${sectionIndex} of ${states.length}`); }
  const last = fullPageCount - 1;
  const next = states[sectionIndex + 1];
  const end = Math.min(next ? (next.pageBoundary ? next.absolutePage - 2 : next.fillingPage - 1) : last, last);
  return { start: Math.min(state.absolutePage - 1, end), end };
}
