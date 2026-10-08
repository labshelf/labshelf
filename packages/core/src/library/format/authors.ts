/** Author names as one short label: "Silva", "Silva & Costa", "Silva et al.". */

/** @returns the surname of "Last, First" or "First Last"; the trimmed full name when no surname can be told. */
export function familyName(author: string): string {
  const name = author.trim();
  const family = name.includes(",") ? name.slice(0, name.indexOf(",")).trim() : (name.split(/\s+/).pop() ?? "");
  return family || name;
}

/** @returns "" for no authors, "A", "A & B" or "A et al." (three or more); blank entries are ignored. */
export function formatAuthors(authors: readonly string[] | undefined): string {
  const families = (authors ?? []).filter((a) => a.trim().length > 0).map(familyName);
  if (families.length <= 2) { return families.join(" & "); }
  return `${families[0]} et al.`;
}
