// Reads the keys of a bracketed citation such as `[@a; @b]`.
// CONTRACT: documents/contracts/qmd-items.md#format
const CITATION = /^\[(@[^\s;[\]]+(?:;[ \t]*@[^\s;[\]]+)*)\]/;

/** Returns the citation at the start of `source` with its length, or null. */
export function matchCitation(source: string): { keys: string[]; length: number } | null {
  const match = CITATION.exec(source);
  if (!match?.[1]) return null;
  return { keys: match[1].split(";").map((key) => key.trim().slice(1)), length: match[0].length };
}
