/** Narrows the gallery's template list by source, format, category and a free-text query. */

import type { ProjectFormat } from "../writing/project/index.js";
import type { TemplateCategory } from "./templateManifest/index.js";
import type { TemplateEntry, TemplateSourceId } from "./templateEntry.js";

export interface TemplateFilter {
  source?: TemplateSourceId;
  /** Empty means every format. */
  formats?: readonly ProjectFormat[];
  category?: TemplateCategory;
  query?: string;
}

function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function matchesWords(entry: TemplateEntry, words: readonly string[]): boolean {
  const haystack = fold([entry.id, entry.name, entry.description, ...entry.authors].join("\n"));
  return words.every((word) => haystack.includes(word));
}

/** The entries that satisfy every given facet and contain every word of the query, in their original order. */
export function deriveFilteredTemplates<T extends TemplateEntry>(entries: readonly T[], filter: TemplateFilter): T[] {
  const words = fold(filter.query ?? "").split(/\s+/).filter((word) => word !== "");
  const formats = filter.formats ?? [];
  return entries.filter((entry) =>
    (filter.source === undefined || entry.source === filter.source)
    && (formats.length === 0 || formats.includes(entry.format))
    && (filter.category === undefined || entry.category === filter.category)
    && matchesWords(entry, words));
}
