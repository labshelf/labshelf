// Works with calendar days written as YYYY-MM-DD: validating one, finding the next, counting days and reading today's.
import { isString } from "../guards/index.js";

const DAY_MS = 86_400_000;
const pad = (n: number): string => String(n).padStart(2, "0");

// TRAP: Date.parse rolls 2026-02-30 over to March 2, so only a round trip rejects impossible days.
/** @returns whether `value` is a `YYYY-MM-DD` text naming a day that exists. */
export function isCalendarDay(value: unknown): value is string {
  if (!isString(value) || !/^\d{4}-\d{2}-\d{2}$/.test(value)) { return false; }
  const time = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
}

/** @returns the day after `day` (YYYY-MM-DD); UTC arithmetic keeps daylight-saving shifts out. */
export function nextDay(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
}

/** The YYYY-MM-DD of `now` in the local time zone, so a day ends at local midnight. */
export function formatLocalDay(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Calendar days from `from` to `to` (both YYYY-MM-DD); UTC arithmetic keeps daylight-saving shifts out. */
export function countDaysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** @returns a `YYYY-MM-DD` day as "Mar 4, 2024"; read in UTC so the day never shifts with the time zone. "" when not a day. */
export function formatDay(day: string): string {
  const t = /^\d{4}-\d{2}-\d{2}$/.test(day) ? Date.parse(day) : NaN;
  return Number.isFinite(t) ? new Date(t).toLocaleDateString("en", { dateStyle: "medium", timeZone: "UTC" }) : "";
}
