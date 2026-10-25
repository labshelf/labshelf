/**
 * Declares the reading status of a paper: the runtime list, the UI label of each status and the click-to-cycle order.
 */
export const PAPER_STATUSES = ["unread", "reading", "done"] as const;
export type ReadingStatus = (typeof PAPER_STATUSES)[number];

export const STATUS_LABEL: Record<ReadingStatus, string> = { unread: "Unread", reading: "Reading", done: "Done" };

export function isReadingStatus(value: unknown): value is ReadingStatus {
  return (PAPER_STATUSES as readonly unknown[]).includes(value);
}

/** The status a click on the status badge moves to: unread, reading, done, then unread again. */
export function deriveNextReadingStatus(status: ReadingStatus): ReadingStatus {
  return PAPER_STATUSES[(PAPER_STATUSES.indexOf(status) + 1) % PAPER_STATUSES.length]!;
}
