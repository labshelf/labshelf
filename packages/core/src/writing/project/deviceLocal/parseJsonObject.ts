// Parses JSON text that must be a plain object, for files read from disk or a synced folder.

/** @returns undefined when the text is not valid JSON or its root is not a non-array object */
export function parseJsonObject(text: string): Record<string, unknown> | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return undefined;
  }
  return raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : undefined;
}
