/** Formats a timestamp as short relative text: "just now", "5m ago", "yesterday", "Mar 4", "Mar 2023". */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * `now` is injected so tests and callers share one clock; dates use the local calendar.
 * @returns the text, "" when `iso` is missing or not a date.
 */
export function relativeTime(iso: string | undefined, now = Date.now()): string {
  if (!iso) { return ""; }
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) { return ""; }
  const seconds = Math.floor((now - then) / 1000);
  if (seconds < MINUTE) { return "just now"; }
  if (seconds < HOUR) { return `${Math.floor(seconds / MINUTE)}m ago`; }
  if (seconds < DAY) { return `${Math.floor(seconds / HOUR)}h ago`; }
  const days = Math.floor(seconds / DAY);
  if (days === 1) { return "yesterday"; }
  if (days < 7) { return `${days}d ago`; }
  if (days < 30) { return `${Math.floor(days / 7)}w ago`; }
  const date = new Date(then);
  const month = MONTHS[date.getMonth()]!;
  return days < 365 ? `${month} ${date.getDate()}` : `${month} ${date.getFullYear()}`;
}
