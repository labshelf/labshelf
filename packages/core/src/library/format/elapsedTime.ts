/**
 * Says how long ago a timestamp was, as sentence text ("just now", "5m ago", "yesterday", "Mar 4", "Mar 2023") or as
 * compact list-cell text ("now", "5 min", "3 h", "1 d", "3 w", "2 mo", "1 y").
 */

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

/**
 * Months count as 30 days and years as 365, so the unit steps are even; the cell's tooltip carries the exact date.
 * @returns the elapsed time in its largest whole unit; "now" under a minute and for a time in the future.
 */
export function compactTime(then: number, now = Date.now()): string {
  const seconds = Math.floor((now - then) / 1000);
  if (seconds < MINUTE) { return "now"; }
  if (seconds < HOUR) { return `${Math.floor(seconds / MINUTE)} min`; }
  if (seconds < DAY) { return `${Math.floor(seconds / HOUR)} h`; }
  const days = Math.floor(seconds / DAY);
  if (days < 7) { return `${days} d`; }
  if (days < 30) { return `${Math.floor(days / 7)} w`; }
  if (days < 365) { return `${Math.floor(days / 30)} mo`; }
  return `${Math.floor(days / 365)} y`;
}
