/** Finds the pages of the full PDF a section covers, from the page its heading lands on and the page the next one starts on. */
import type { SectionState } from "../sectionStateFile.js";

export interface PageRange {
  /** 0-based index of the first page. */
  start: number;
  /** 0-based index of the last page, inclusive. */
  end: number;
}

// INVARIANT: a section starts on the page its heading lands on, and ends on the page being filled when the next heading
// started: that page holds this section's tail whether the next heading starts mid-page, is pushed to a fresh page or
// clears the page first, as `\chapter` and `\part` do.
export function sectionPageRange(states: readonly SectionState[], sectionIndex: number, fullPageCount: number): PageRange {
  const state = states[sectionIndex];
  if (!state) { throw new Error(`sectionPageRange: no section state ${sectionIndex} of ${states.length}`); }
  const last = fullPageCount - 1;
  const next = states[sectionIndex + 1];
  const end = Math.min(next ? next.fillingPage - 1 : last, last);
  return { start: Math.min(state.absolutePage - 1, end), end };
}
