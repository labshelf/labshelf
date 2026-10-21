// Checks the type of one field read from a synced JSON file.
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export const isString = (value: unknown): value is string => typeof value === "string";
export const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value !== "";
export const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";
export const isOptional = <T>(value: unknown, check: (v: unknown) => v is T): boolean => value === undefined || check(value);
// TRAP: Date.parse rolls 2026-02-30 over to March 2, so only a round trip rejects impossible days.
export function isDay(value: unknown): value is string {
  if (!isString(value) || !/^\d{4}-\d{2}-\d{2}$/.test(value)) { return false; }
  const time = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
}
export const isPage = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 1;
export const isIdList = (value: unknown): value is string[] => Array.isArray(value) && value.every(isNonEmptyString);
