/** Picks the paper whose reading position was saved last, from the stats the library UI already derives. */
import type { PaperStats } from "./protocol/index.js";

export interface LastReadPaper {
  paperId: string;
  page: number;
  readAt: string;
}

/** @returns the paper read most recently; undefined when no paper has a saved position */
export function lastReadPaper(stats: Readonly<Record<string, PaperStats>>): LastReadPaper | undefined {
  let latest: LastReadPaper | undefined;
  for (const [paperId, { lastPage, lastRead }] of Object.entries(stats)) {
    if (lastPage === undefined || lastRead === undefined) { continue; }
    const at = Date.parse(lastRead);
    if (Number.isNaN(at)) { continue; }
    if (!latest || at > Date.parse(latest.readAt)) { latest = { paperId, page: lastPage, readAt: lastRead }; }
  }
  return latest;
}
