// Writes the replacement over each search match that still matches, and counts the replaced matches.
import { matchReplacement, type LibraryFileSystem, type MatchLocation } from "@labshelf/core";

/** Replaces the matches in their files; a match whose text changed since the search is left alone. */
export async function replaceInFiles(fs: LibraryFileSystem, matches: readonly MatchLocation[], pattern: RegExp, replacement: string): Promise<number> {
  const byPath = new Map<string, MatchLocation[]>();
  for (const match of matches) byPath.set(match.path, [...(byPath.get(match.path) ?? []), match]);
  let count = 0;
  for (const [path, inFile] of byPath) {
    const original = await fs.readText(path);
    // The capture group keeps each line's own ending; text sits at even indexes.
    const parts = original.split(/(\r?\n)/);
    const lines = [...parts];
    // Highest column first, so an edit never shifts the columns of those still to apply.
    for (const { line, column, length } of [...inFile].sort((a, b) => b.line - a.line || b.column - a.column)) {
      const text = lines[line * 2];
      if (text === undefined) continue;
      // Computed against the original line, so one edit never changes what another match expands to.
      const replaced = matchReplacement(text, pattern, { column, length }, replacement);
      if (replaced === undefined) continue;
      const current = parts[line * 2]!;
      parts[line * 2] = current.slice(0, column) + replaced + current.slice(column + length);
      count += 1;
    }
    const next = parts.join("");
    if (next !== original) await fs.writeText(path, next);
  }
  return count;
}
