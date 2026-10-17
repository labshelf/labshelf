// Validates a message from the project search page before the host acts on it.
import type { SearchOptions } from "../searchPattern.js";
import type { MatchLocation, SearchToHost } from "./messages.js";

type Raw = Record<string, unknown>;

const isRecord = (value: unknown): value is Raw => !!value && typeof value === "object" && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === "string";
const isCount = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;

function options(raw: unknown): SearchOptions | undefined {
  if (!isRecord(raw)) { return undefined; }
  const { matchCase, regex, wholeWord } = raw;
  if (typeof matchCase !== "boolean" || typeof regex !== "boolean" || typeof wholeWord !== "boolean") { return undefined; }
  return { matchCase, regex, wholeWord };
}

function location(raw: Raw): MatchLocation | undefined {
  const { path, line, column, length } = raw;
  return isText(path) && isCount(line) && isCount(column) && isCount(length) ? { path, line, column, length } : undefined;
}

/** The typed message, or undefined when any field is missing or of the wrong type. */
export function parseSearchMessage(raw: unknown): SearchToHost | undefined {
  if (!isRecord(raw)) { return undefined; }
  const at = location(raw);
  switch (raw["type"]) {
    case "ready": return { type: "ready" };
    case "search": {
      const parsed = options(raw["options"]);
      const { query, scope } = raw;
      return parsed && isText(query) && (scope === "file" || scope === "project") ? { type: "search", query, options: parsed, scope } : undefined;
    }
    case "open": return at && { type: "open", ...at };
    case "replace": return at && isText(raw["replacement"]) ? { type: "replace", ...at, replacement: raw["replacement"] } : undefined;
    case "replaceFile": return isText(raw["path"]) && isText(raw["replacement"]) ? { type: "replaceFile", path: raw["path"], replacement: raw["replacement"] } : undefined;
    case "replaceAll": return isText(raw["replacement"]) ? { type: "replaceAll", replacement: raw["replacement"] } : undefined;
    default: return undefined;
  }
}
