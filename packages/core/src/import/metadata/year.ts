/** Extracts a four-digit year from a date string. */

/**
 * Extracts a four-digit year (1900–2099) from a raw date string such as a PDF creation date.
 * @returns The year as a number, or undefined if no match is found.
 */
export function extractYear(rawValue: string | undefined): number | undefined {
  if (!rawValue) {
    return undefined;
  }

  const match = rawValue.match(/(?:(?:19|20)\d{2})/);
  return match ? Number(match[0]) : undefined;
}
