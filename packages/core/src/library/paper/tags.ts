/** Normalises tag lists the same way for every app. */

/** Trimmed, inner whitespace collapsed, blanks dropped, de-duplicated case-insensitively (first spelling wins), order kept. */
export function normalizeTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim().replace(/\s+/g, " ");
    const key = tag.toLowerCase();
    if (tag && !seen.has(key)) {
      seen.add(key);
      out.push(tag);
    }
  }
  return out;
}

/** @returns `tags` without the ones in `remove` (ignoring case), with `add` appended, normalised */
export function deriveEditedTags(tags: readonly string[], add: readonly string[], remove: readonly string[]): string[] {
  const removeKeys = new Set(remove.map((tag) => tag.trim().toLowerCase()));
  return normalizeTags([...tags.filter((tag) => !removeKeys.has(tag.toLowerCase())), ...add]);
}
