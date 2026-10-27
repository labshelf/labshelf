// Checks the type of one field read from a synced JSON file.
import { isString } from "../../../guards/index.js";

// TRAP: Date.parse rolls 2026-02-30 over to March 2, so only a round trip rejects impossible days.
export function isDay(value: unknown): value is string {
  if (!isString(value) || !/^\d{4}-\d{2}-\d{2}$/.test(value)) { return false; }
  const time = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
}
export const isPage = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 1;
