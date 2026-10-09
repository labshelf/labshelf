/** Builds the citation key that names a paper's folder. */

const MAX_TITLE_KEY_LENGTH = 48;

/**
 * Builds a citation key from the best available source (identifier, title, or file stem) combined with the year.
 * The file stem comes last: it is whatever the user's download was called
 * ("artigo-1", "main"), which says nothing about the paper once a title is known.
 * @returns A lowercase alphanumeric cite key string, optionally suffixed with the year.
 */
export function buildCiteKey(fileStem: string, title: string, year?: number, identifier?: string): string {
  const slug = (value: string): string =>
    value
      .normalize("NFD")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");

  // The key doubles as the paper's folder name, so a title-derived one is capped.
  const base = slug(identifier ?? "") || slug(title).slice(0, MAX_TITLE_KEY_LENGTH) || slug(fileStem);
  return year ? `${base}${year}` : base;
}
