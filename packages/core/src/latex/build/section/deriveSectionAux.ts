/** Filters a full build's aux for a section document: references, labels and citations stay, table and bibliography writes go. */

// TRAP: these lines would write the section's partial toc, lof and lot over the full ones, or repeat bibliography setup.
const DROPPED = /^\\(?:@writefile|contentsline|bibstyle|bibdata)(?![A-Za-z@])/;

// INVARIANT: TeX never wraps `\write` lines in a file, so every aux entry is one line.
export function deriveSectionAux(auxText: string): string {
  return auxText.split("\n").filter((line) => !DROPPED.test(line)).join("\n");
}
