// Narrows unknown to a string, boolean or list of strings, the field types of synced JSON files and messages.
export const isString = (value: unknown): value is string => typeof value === "string";
export const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value !== "";
export const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";
export const isOptional = <T>(value: unknown, check: (v: unknown) => v is T): boolean => value === undefined || check(value);
export const isNonEmptyStringList = (value: unknown): value is string[] => Array.isArray(value) && value.every(isNonEmptyString);
export const isNonBlankString = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";
export const isStringUpTo =
  (max: number) =>
  (value: unknown): value is string =>
    typeof value === "string" && value.length <= max;
export const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
export const isCount = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;
export const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(isString);
export const isTimestamp = (value: unknown): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value));
export function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}
