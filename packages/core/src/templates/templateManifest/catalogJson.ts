// Parses an index.json text and tests parsed values for being plain objects, for the Community and Universe index readers.

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export type ParsedJson = { ok: true; value: unknown } | { ok: false; reason: string };

export function parseIndexJson(jsonText: string): ParsedJson {
  try {
    return { ok: true, value: JSON.parse(jsonText) };
  } catch (error) {
    return { ok: false, reason: `invalid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
}
