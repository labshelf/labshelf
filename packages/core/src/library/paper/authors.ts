/** Formats author names: the one family-name rule, a short label ("Silva", "Silva & Costa", "Silva et al.") and a person key. */

export interface AuthorName {
  given: string;
  family: string;
}

// Lower-case name particles that belong to the family name: "Ludwig van Beethoven" is "van Beethoven".
const PARTICLES = new Set(["van", "von", "der", "den", "de", "del", "della", "da", "di", "du", "la", "le", "dos", "das"]);

/** @returns the given and family names of "Given Family" or "Family, Given"; a single word is a family name. */
export function splitName(raw: string): AuthorName {
  const name = raw.trim().replace(/\s+/g, " ");
  const comma = name.indexOf(",");
  if (comma !== -1) { return { family: name.slice(0, comma).trim(), given: name.slice(comma + 1).trim() }; }
  const parts = name.split(" ");
  let at = parts.length - 1;
  while (at > 1 && PARTICLES.has(parts[at - 1]!.toLowerCase())) { at--; }
  return { given: parts.slice(0, at).join(" "), family: parts.slice(at).join(" ") };
}

/** @returns the family name of "Last, First" or "First Last", particles included; the trimmed full name when none can be told. */
export function deriveFamilyName(author: string): string {
  return splitName(author).family || author.trim();
}

/** @returns "" for no authors, "A", "A & B" or "A et al." (three or more); blank entries are ignored. */
export function formatAuthors(authors: readonly string[] | undefined): string {
  const families = (authors ?? []).filter((a) => a.trim().length > 0).map(deriveFamilyName);
  if (families.length <= 2) { return families.join(" & "); }
  return `${families[0]} et al.`;
}

/** @returns "family|g", so "Ashish Vaswani" and "Vaswani, A." count as the same person. */
export function normalizeAuthor(author: string): string {
  const { given, family } = splitName(author);
  return `${family.toLowerCase()}|${given.charAt(0).toLowerCase()}`;
}
