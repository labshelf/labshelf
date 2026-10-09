/** Coercion of untyped values into clean strings. */

/**
 * Coerces an unknown value to a non-empty trimmed string, returning undefined for blanks and non-strings.
 * @returns The trimmed string, or undefined.
 */
export function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Collapses runs of whitespace to single spaces; undefined when nothing is left. */
export function collapseWhitespace(value: string): string | undefined {
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
