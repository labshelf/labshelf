// Resolves a paper id against the Library snapshot, or marks it missing.
import type { PaperRecord } from "../../model/index.js";
import type { ResolvedPaper } from "./viewTypes.js";

/** The part of a Library snapshot the views read. */
export type LibraryPapers = ReadonlyMap<string, { readonly record: PaperRecord }>;

export function resolvePaper(id: string, library: LibraryPapers): ResolvedPaper {
  const record = library.get(id)?.record;
  if (!record) return { id, missing: true };
  const base = { id, missing: false as const, title: record.title, authors: record.authors ?? [], status: record.status };
  return record.year === undefined ? base : { ...base, year: record.year };
}
