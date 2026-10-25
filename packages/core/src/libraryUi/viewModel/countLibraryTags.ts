// Lists every tag in the library once with its paper count, for the sidebar's Tags section and the tag field's suggestions.
import type { PaperRecord } from "../../model/index.js";

export interface TagCount { tag: string; count: number }

/** Case-insensitive: the first spelling wins; a paper counts once per tag. Sorted A to Z. */
export function countLibraryTags(papers: readonly Pick<PaperRecord, "tags">[]): TagCount[] {
  const found = new Map<string, TagCount>();
  for (const { tags } of papers) {
    for (const key of new Set((tags ?? []).map((t) => t.toLowerCase()))) {
      const entry = found.get(key);
      if (entry) entry.count++;
      else found.set(key, { tag: tags!.find((t) => t.toLowerCase() === key)!, count: 1 });
    }
  }
  return [...found.values()].sort((a, b) => a.tag.localeCompare(b.tag));
}
