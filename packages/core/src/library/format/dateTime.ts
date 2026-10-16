/** Formats a timestamp as a full local date and time for tooltips ("Mar 4, 2024, 2:05 PM"), and a calendar day as "Mar 4, 2024". */

/** @returns the English medium date with a short time; "" when `iso` is missing or not a date. */
export function formatDateTime(iso: string | undefined): string {
  if (!iso) { return ""; }
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" }) : "";
}

/** @returns a `YYYY-MM-DD` day as "Mar 4, 2024"; read in UTC so the day never shifts with the time zone. "" when not a day. */
export function formatDay(day: string): string {
  const t = /^\d{4}-\d{2}-\d{2}$/.test(day) ? Date.parse(day) : NaN;
  return Number.isFinite(t) ? new Date(t).toLocaleDateString("en", { dateStyle: "medium", timeZone: "UTC" }) : "";
}
