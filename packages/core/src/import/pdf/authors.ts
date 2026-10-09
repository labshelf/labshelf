/** Splits raw author strings into individual author names. */

/**
 * Splits an author string (or passes through an array) into individual trimmed author names.
 * @returns Array of non-empty author name strings.
 */
export function normalizeAuthors(rawValue: string | string[] | undefined): string[] {
  if (Array.isArray(rawValue)) {
    return rawValue.map((value) => value.trim()).filter(Boolean);
  }

  if (!rawValue) {
    return [];
  }

  const parts = rawValue
    .split(/\s+and\s+|;\s*|\s*&\s*/i)
    .map((value) => value.trim())
    .filter(Boolean);

  // Info.Author often holds "Ann Lee, Bo Chen, Cy Diaz" — one entry to the
  // split above. Commas are only safe to break on when every piece still looks
  // like a full name, since "Lee, Ann" is one author written surname-first.
  if (parts.length === 1 && parts[0]) {
    const commaSeparated = parts[0]
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (commaSeparated.length > 2 && commaSeparated.every(looksLikeFullName)) {
      return commaSeparated;
    }
  }

  return parts;
}

// A full name carries at least a forename (or initial) and a surname.
function looksLikeFullName(value: string): boolean {
  return value.split(/\s+/).filter((word) => word.length > 0).length >= 2 && value.length <= 80;
}
