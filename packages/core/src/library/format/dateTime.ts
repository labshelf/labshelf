/** Formats a timestamp as a full local date and time for tooltips: "Mar 4, 2024, 2:05 PM". */

/** @returns the English medium date with a short time; "" when `iso` is missing or not a date. */
export function formatDateTime(iso: string | undefined): string {
  if (!iso) { return ""; }
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" }) : "";
}
