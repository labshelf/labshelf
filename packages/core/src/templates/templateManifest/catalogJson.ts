// Parses an index.json text for the Community and Universe index readers.

import { formatError } from "../../errors/index.js";

export type ParsedJson = { ok: true; value: unknown } | { ok: false; reason: string };

export function parseCatalogIndexJson(jsonText: string): ParsedJson {
  try {
    return { ok: true, value: JSON.parse(jsonText) };
  } catch (error) {
    return { ok: false, reason: `invalid JSON: ${formatError(error)}` };
  }
}
