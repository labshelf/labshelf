// Turns a timestamp into the reader's local calendar day and measures distances between days.

const DAY_MS = 86_400_000;
const pad = (n: number): string => String(n).padStart(2, "0");

/** The YYYY-MM-DD of `now` in the local time zone, so a day ends at local midnight. */
export function localDay(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Calendar days from `from` to `to` (both YYYY-MM-DD); UTC arithmetic keeps daylight-saving shifts out. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}
