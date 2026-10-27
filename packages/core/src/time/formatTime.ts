// Formats a timestamp for display. Each function keeps the locale and time zone its screen has always used.
import { MONTHS } from "./months.js";

/** @returns the English medium date with a short time in the local zone ("Mar 4, 2024, 2:05 PM"); "" when `iso` is missing or not a date. */
export function formatDateTime(iso: string | undefined): string {
  if (!iso) { return ""; }
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" }) : "";
}

// Fixed month names and UTC keep the text identical across locales and time zones.
/** @returns the UTC date as "4 Mar 2024"; "" when `iso` is not a date. */
export function formatUtcDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** @returns the local date as "Mar 4" in US English. */
export function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** @returns the local time of day with two-digit hour and minute, in the runtime locale. */
export function formatClockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** @returns the local month, day and time of day, in the runtime locale. */
export function formatShortDateTime(iso: string): string {
  return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** `now` is injected so tests and callers share one clock. @returns "Today", "Yesterday" or the weekday, month and day in the runtime locale. */
export function formatDayLabel(iso: string, now = Date.now()): string {
  const day = new Date(iso).toDateString();
  if (day === new Date(now).toDateString()) { return "Today"; }
  if (day === new Date(now - 86_400_000).toDateString()) { return "Yesterday"; }
  return new Date(iso).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
}

/** @returns the date and time in the runtime's default locale and local zone. */
export function formatLocaleDateTime(iso: string): string {
  return new Date(iso).toLocaleString();
}
